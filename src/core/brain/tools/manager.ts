/**
 * Internal Tool Manager
 *
 * Manages execution of internal tools with caching, statistics tracking,
 * and integration with the broader agent architecture.
 */

import { logger } from '../../logger/index.js';
import { ToolExecutionResult } from '../../mcp/types.js';
import { InternalToolRegistry } from './registry.js';
import {
	IInternalToolManager,
	InternalTool,
	InternalToolSet,
	InternalToolCategory,
	InternalToolManagerConfig,
	InternalToolContext,
	ToolExecutionStats,
	INTERNAL_TOOL_PREFIX,
	createInternalToolName,
	isInternalToolName,
} from './types.js';

/**
 * Cache entry for tool execution statistics
 */
interface StatsEntry {
	stats: ToolExecutionStats;
	executionTimes: number[];
	maxHistorySize: number;
}

/**
 * Default configuration for the internal tool manager
 */
const DEFAULT_CONFIG: Required<InternalToolManagerConfig> = {
	enabled: true,
	timeout: 30000, // 30 seconds
	enableCache: true,
	cacheTimeout: 300000, // 5 minutes
};

/**
 * Internal Tool Manager implementation
 */
export class InternalToolManager implements IInternalToolManager {
	private config: Required<InternalToolManagerConfig>;
	private registry: InternalToolRegistry;
	private initialized = false;
	private stats = new Map<string, StatsEntry>();
	private readonly maxExecutionHistorySize = 100;
	private services?: {
		embeddingManager?: any;
		vectorStoreManager?: any;
		llmService?: any;
	};

	constructor(config: InternalToolManagerConfig = {}) {
		this.config = { ...DEFAULT_CONFIG, ...config };
		this.registry = InternalToolRegistry.getInstance();
	}

	/**
	 * Initialize the internal tool manager
	 */
	public async initialize(): Promise<void> {
		if (this.initialized) {
			logger.warn('InternalToolManager: Already initialized');
			return;
		}

		if (!this.config.enabled) {
			logger.info('InternalToolManager: Disabled by configuration');
			this.initialized = true; // Mark as initialized even when disabled
			return;
		}

		try {
			logger.info('InternalToolManager: Initializing...');

			// Initialize the registry
			await this.registry.initialize();

			this.initialized = true;
			logger.info(`InternalToolManager: Initialized successfully with config:`, {
				enabled: this.config.enabled,
				timeout: this.config.timeout,
				enableCache: this.config.enableCache,
				cacheTimeout: this.config.cacheTimeout,
			});
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			logger.error(`InternalToolManager: Initialization failed: ${errorMessage}`);
			throw error;
		}
	}

	/**
	 * Register a new internal tool
	 */
	public registerTool(tool: InternalTool): {
		success: boolean;
		message: string;
		conflictedWith?: string;
	} {
		this.ensureInitialized();

		const result = this.registry.registerTool(tool);

		if (result.success) {
			// Initialize stats for the new tool
			this.initializeToolStats(tool.name);
			logger.info(`InternalToolManager: Successfully registered tool '${tool.name}'`);
		} else {
			logger.warn(`InternalToolManager: Failed to register tool '${tool.name}': ${result.message}`);
		}

		return result;
	}

	/**
	 * Unregister an internal tool
	 */
	public unregisterTool(toolName: string): boolean {
		this.ensureInitialized();

		const normalizedName = createInternalToolName(toolName);
		const result = this.registry.unregisterTool(normalizedName);

		if (result) {
			// Clear stats for the removed tool
			this.stats.delete(normalizedName);
			logger.info(`InternalToolManager: Successfully unregistered tool '${normalizedName}'`);
		}

		return result;
	}

	/**
	 * Get all registered internal tools
	 */
	public getAllTools(): InternalToolSet {
		this.ensureInitialized();
		return this.registry.getAllTools();
	}

	/**
	 * Get a specific internal tool by name
	 */
	public getTool(toolName: string): InternalTool | undefined {
		this.ensureInitialized();
		return this.registry.getTool(toolName);
	}

	/**
	 * Check if a tool name is an internal tool
	 */
	public isInternalTool(toolName: string): boolean {
		if (!this.initialized || !this.config.enabled) {
			return false;
		}
		return this.registry.isInternalTool(toolName);
	}

	/**
	 * Execute an internal tool
	 */
	public async executeTool(
		toolName: string,
		args: any,
		context?: Partial<InternalToolContext>
	): Promise<ToolExecutionResult> {
		this.ensureInitialized();

		const startTime = Date.now();
		const normalizedName = createInternalToolName(toolName);

		// Get the tool
		const tool = this.registry.getTool(normalizedName);
		if (!tool) {
			throw new Error(`Internal tool '${normalizedName}' not found`);
		}

		// Create execution context
		const execContext: InternalToolContext = {
			toolName,
			startTime,
			sessionId: context?.sessionId,
			userId: context?.userId || '',
			metadata: context?.metadata,
			services: this.services || {},
		};

		logger.info(`InternalToolManager: Executing tool '${normalizedName}'`, {
			toolName: normalizedName,
			category: tool.category,
			hasArgs: !!args,
			sessionId: execContext.sessionId,
		});

		try {
			// Execute with timeout
			const result = await this.executeWithTimeout(tool, args, execContext);

			// Record successful execution
			const executionTime = Date.now() - startTime;
			this.recordExecution(normalizedName, true, executionTime);

			logger.info(`InternalToolManager: Tool '${normalizedName}' executed successfully`, {
				toolName: normalizedName,
				executionTime,
			});

			return result;
		} catch (error) {
			// Record failed execution
			const executionTime = Date.now() - startTime;
			this.recordExecution(normalizedName, false, executionTime);

			const errorMessage = error instanceof Error ? error.message : String(error);
			logger.error(`InternalToolManager: Tool '${normalizedName}' execution failed`, {
				toolName: normalizedName,
				error: errorMessage,
				executionTime,
			});

			throw new Error(`Internal tool execution failed: ${errorMessage}`);
		}
	}

	/**
	 * Get tools by category
	 */
	public getToolsByCategory(category: InternalToolCategory): InternalToolSet {
		this.ensureInitialized();
		return this.registry.getToolsByCategory(category);
	}

	/**
	 * Get execution statistics for a tool
	 */
	public getToolStats(toolName: string): ToolExecutionStats | undefined {
		const normalizedName = createInternalToolName(toolName);
		const entry = this.stats.get(normalizedName);
		return entry ? { ...entry.stats } : undefined;
	}

	/**
	 * Get overall manager statistics
	 */
	public getManagerStats(): {
		totalTools: number;
		toolsByCategory: Record<InternalToolCategory, number>;
		totalExecutions: number;
	} {
		this.ensureInitialized();

		const registryStats = this.registry.getRegistryStats();
		let totalExecutions = 0;

		for (const entry of this.stats.values()) {
			totalExecutions += entry.stats.totalExecutions;
		}

		return {
			totalTools: registryStats.totalTools,
			toolsByCategory: registryStats.toolsByCategory,
			totalExecutions,
		};
	}

	/**
	 * Get all tool statistics
	 */
	public getStatistics(): Record<string, ToolExecutionStats> {
		const allStats: Record<string, ToolExecutionStats> = {};

		for (const [toolName, entry] of this.stats.entries()) {
			allStats[toolName] = { ...entry.stats };
		}

		return allStats;
	}

	/**
	 * Get available tools list
	 */
	public async getAvailableTools(): Promise<
		Array<{ name: string; description: string; category: string }>
	> {
		this.ensureInitialized();

		const tools = this.registry.getAllTools();
		return Object.values(tools).map(tool => ({
			name: tool.name,
			description: tool.description,
			category: tool.category,
		}));
	}

	/**
	 * Clear all execution statistics
	 */
	public clearStats(): void {
		this.stats.clear();
		logger.info('InternalToolManager: Cleared all execution statistics');
	}

	/**
	 * Shutdown the internal tool manager
	 */
	public async shutdown(): Promise<void> {
		if (!this.initialized) {
			return;
		}

		try {
			logger.info('InternalToolManager: Shutting down...');

			// Clear all data
			this.clearStats();
			this.registry.clear();

			this.initialized = false;
			logger.info('InternalToolManager: Shutdown completed');
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			logger.error(`InternalToolManager: Shutdown failed: ${errorMessage}`);
			throw error;
		}
	}

	/**
	 * Execute tool with timeout handling
	 */
	private async executeWithTimeout(
		tool: InternalTool,
		args: any,
		context: InternalToolContext
	): Promise<ToolExecutionResult> {
		return new Promise((resolve, reject) => {
			const timeoutId = setTimeout(() => {
				reject(new Error(`Tool execution timeout after ${this.config.timeout}ms`));
			}, this.config.timeout);

			tool
				.handler(args, context)
				.then(result => {
					clearTimeout(timeoutId);
					resolve(result);
				})
				.catch(error => {
					clearTimeout(timeoutId);
					reject(error);
				});
		});
	}

	/**
	 * Record tool execution statistics
	 */
	private recordExecution(toolName: string, success: boolean, executionTime: number): void {
		let entry = this.stats.get(toolName);

		if (!entry) {
			entry = this.createStatsEntry(toolName);
			this.stats.set(toolName, entry);
		}

		// Update statistics
		entry.stats.totalExecutions++;
		entry.stats.lastExecution = new Date().toISOString();

		if (success) {
			entry.stats.successfulExecutions++;
		} else {
			entry.stats.failedExecutions++;
		}

		// Update execution times for average calculation
		entry.executionTimes.push(executionTime);

		// Keep only recent execution times for memory efficiency
		if (entry.executionTimes.length > entry.maxHistorySize) {
			entry.executionTimes = entry.executionTimes.slice(-entry.maxHistorySize);
		}

		// Calculate average execution time
		entry.stats.averageExecutionTime =
			entry.executionTimes.reduce((sum, time) => sum + time, 0) / entry.executionTimes.length;
	}

	/**
	 * Initialize statistics for a tool
	 */
	private initializeToolStats(toolName: string): void {
		const normalizedName = createInternalToolName(toolName);
		if (!this.stats.has(normalizedName)) {
			this.stats.set(normalizedName, this.createStatsEntry(normalizedName));
		}
	}

	/**
	 * Create a new stats entry
	 */
	private createStatsEntry(toolName: string): StatsEntry {
		return {
			stats: {
				toolName,
				totalExecutions: 0,
				successfulExecutions: 0,
				failedExecutions: 0,
				averageExecutionTime: 0,
			},
			executionTimes: [],
			maxHistorySize: this.maxExecutionHistorySize,
		};
	}

	/**
	 * Ensure the manager is initialized
	 */
	private ensureInitialized(): void {
		if (!this.initialized) {
			throw new Error(
				'InternalToolManager must be initialized before use. Call initialize() first.'
			);
		}

		if (!this.config.enabled) {
			throw new Error('InternalToolManager is disabled by configuration');
		}
	}

	/**
	 * Get configuration
	 */
	public getConfig(): Required<InternalToolManagerConfig> {
		return { ...this.config };
	}

	/**
	 * Check if manager is initialized
	 */
	public isInitialized(): boolean {
		return this.initialized;
	}

	/**
	 * Check if manager is enabled
	 */
	public isEnabled(): boolean {
		return this.config.enabled;
	}

	/**
	 * Set agent services for tools that need access to them
	 */
	public setServices(services: {
		embeddingManager?: any;
		vectorStoreManager?: any;
		llmService?: any;
	}): void {
		this.services = services;
		logger.debug('InternalToolManager: Services configured', {
			hasEmbeddingManager: !!services.embeddingManager,
			hasVectorStoreManager: !!services.vectorStoreManager,
			hasLlmService: !!services.llmService,
		});
	}
}
