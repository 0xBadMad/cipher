/**
 * Tool Definitions Module
 *
 * This module exports all internal tool definitions for the Cipher agent.
 * It provides a centralized registry of all available tools organized by category.
 */

// Export all tool categories
export * from './memory/index.js';
export * from './knowledge_graph/index.js';

// Import types and utilities
import type { InternalToolSet } from '../types.js';
import { logger } from '../../../logger/index.js';

/**
 * Get all tools from all categories
 */
export async function getAllToolDefinitions(): Promise<InternalToolSet> {
	try {
		logger.debug('Loading all tool definitions...');

		// Import all tools dynamically
		const [memoryTools, knowledgeGraphTools] = await Promise.all([
			import('./memory/index.js').then(m => m.getMemoryTools()),
			import('./knowledge_graph/index.js').then(m => m.getKnowledgeGraphTools()),
		]);

		// Combine all tools (reasoning tools are already included in memoryTools now)
		const allTools: InternalToolSet = {
			...memoryTools,
			...knowledgeGraphTools,
		};

		logger.info('Tool definitions loaded successfully', {
			totalTools: Object.keys(allTools).length,
			memoryTools: Object.keys(memoryTools).length,
			knowledgeGraphTools: Object.keys(knowledgeGraphTools).length,
		});

		return allTools;
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		logger.error('Failed to load tool definitions', { error: errorMessage });
		throw new Error(`Failed to load tool definitions: ${errorMessage}`);
	}
}

/**
 * Register all tool definitions with the internal tool manager
 */
export async function registerAllTools(toolManager: any): Promise<{
	registered: string[];
	failed: { name: string; error: string }[];
	total: number;
}> {
	try {
		logger.info('Registering all internal tools...');

		const tools = await getAllToolDefinitions();
		const registered: string[] = [];
		const failed: { name: string; error: string }[] = [];

		// Register each tool
		for (const [toolName, tool] of Object.entries(tools)) {
			try {
				const result = toolManager.registerTool(tool);
				if (result.success) {
					registered.push(toolName);
					logger.debug(`Successfully registered tool: ${toolName}`);
				} else {
					failed.push({ name: toolName, error: result.message });
					logger.warn(`Failed to register tool ${toolName}: ${result.message}`);
				}
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				failed.push({ name: toolName, error: errorMessage });
				logger.error(`Error registering tool ${toolName}: ${errorMessage}`);
			}
		}

		const result = {
			registered,
			failed,
			total: Object.keys(tools).length,
		};

		logger.info('Tool registration completed', {
			totalTools: result.total,
			successfullyRegistered: result.registered.length,
			failed: result.failed.length,
		});

		return result;
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		logger.error('Failed to register tools', { error: errorMessage });
		throw new Error(`Failed to register tools: ${errorMessage}`);
	}
}

/**
 * Tool category information for documentation and discovery
 */
export const TOOL_CATEGORIES = {
	memory: {
		description: 'Tools for managing facts, memories, knowledge storage, and reasoning patterns',
		tools: [
			'extract_and_operate_memory', 
			'memory_search', 
			'store_reasoning_memory',
			'extract_reasoning_steps',
			'evaluate_reasoning',
			'search_reasoning_patterns'
		] as string[],
		useCase: 'Use these tools to capture, search, and store important information and reasoning patterns for future reference',
	},
	knowledge_graph: {
		description: 'Tools for managing and querying knowledge graphs',
		tools: [
			'add_node',
			'add_edge',
			'search_graph',
			'get_neighbors',
			'extract_entities',
			'update_node',
			'delete_node',
			'query_graph',
			'intelligent_processor',
			'enhanced_search',
			'relationship_manager',
		] as string[],
		useCase:
			'Use these tools to build, query, and manage knowledge graphs for understanding relationships between entities',
	},
};

/**
 * Get tool information by name
 */
export function getToolInfo(toolName: string): {
	category: string;
	description: string;
	useCase: string;
} | null {
	// Normalize the tool name (remove cipher_ prefix if present)
	const normalizedName = toolName.replace(/^cipher_/, '');

	for (const [categoryName, categoryInfo] of Object.entries(TOOL_CATEGORIES)) {
		if (categoryInfo.tools.includes(normalizedName)) {
			return {
				category: categoryName,
				description: categoryInfo.description,
				useCase: categoryInfo.useCase,
			};
		}
	}

	return null;
}

/**
 * Get tools by category
 */
export function getToolsByCategory(category: keyof typeof TOOL_CATEGORIES): string[] {
	const categoryInfo = TOOL_CATEGORIES[category];
	if (!categoryInfo) {
		return [];
	}

	// Return tool names with cipher_ prefix as they appear in the system
	return categoryInfo.tools.map(toolName => `cipher_${toolName}`);
}
