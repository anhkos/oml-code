/**
 * Tool Registry - Central repository for all available tools
 * 
 * Provides:
 * - Tool registration and lookup
 * - Layer-based filtering
 * - Tool metadata management
 * - Plugin lifecycle management
 */

import type {
    Tool,
    ToolMetadata,
    ToolRegistryEntry,
    ToolQueryOptions,
    ModelingLayer,
} from './tool-metadata.js';

/**
 * Central tool registry - singleton instance
 */
class ToolRegistry {
    private tools: Map<string, ToolRegistryEntry> = new Map();
    private layerIndex: Map<ModelingLayer, Set<string>> = new Map();
    private tagIndex: Map<string, Set<string>> = new Map();

    constructor() {
        // Initialize layer indices
        const layers: ModelingLayer[] = ['core', 'vocabulary', 'description', 'axiom', 'methodology', 'query', 'utility'];
        for (const layer of layers) {
            this.layerIndex.set(layer, new Set());
        }
    }

    /**
     * Register a single tool
     */
    registerTool(tool: Tool, modulePath: string, metadata?: Partial<ToolMetadata>): void {
        if (!tool.name) {
            throw new Error('Tool must have a name property');
        }

        if (this.tools.has(tool.name)) {
            throw new Error(`Tool '${tool.name}' is already registered`);
        }

        // Create metadata with defaults
        const finalMetadata: ToolMetadata = {
            id: tool.name,
            displayName: this.toDisplayName(tool.name),
            layer: 'utility',
            severity: 'medium',
            version: '1.0.0',
            shortDescription: tool.description?.split('\n')[0] || tool.name,
            description: tool.description || tool.name,
            ...metadata,
        };

        // Validate metadata
        this.validateMetadata(finalMetadata);

        const entry: ToolRegistryEntry = {
            tool,
            metadata: finalMetadata,
            modulePath,
            loadedAt: new Date(),
            usageCount: 0,
        };

        // Register in main map
        this.tools.set(tool.name, entry);

        // Update layer index
        const layerTools = this.layerIndex.get(finalMetadata.layer);
        if (layerTools) {
            layerTools.add(tool.name);
        }

        // Update tag index
        if (finalMetadata.tags) {
            for (const tag of finalMetadata.tags) {
                if (!this.tagIndex.has(tag)) {
                    this.tagIndex.set(tag, new Set());
                }
                this.tagIndex.get(tag)!.add(tool.name);
            }
        }
    }

    /**
     * Register multiple tools at once
     */
    registerTools(tools: Array<{ tool: Tool; modulePath: string; metadata?: Partial<ToolMetadata> }>): void {
        for (const { tool, modulePath, metadata } of tools) {
            this.registerTool(tool, modulePath, metadata);
        }
    }

    /**
     * Unregister a tool
     */
    unregisterTool(toolName: string): boolean {
        const entry = this.tools.get(toolName);
        if (!entry) {
            return false;
        }

        // Remove from main map
        this.tools.delete(toolName);

        // Remove from layer index
        const layerTools = this.layerIndex.get(entry.metadata.layer);
        if (layerTools) {
            layerTools.delete(toolName);
        }

        // Remove from tag index
        if (entry.metadata.tags) {
            for (const tag of entry.metadata.tags) {
                const tagTools = this.tagIndex.get(tag);
                if (tagTools) {
                    tagTools.delete(toolName);
                }
            }
        }

        return true;
    }

    /**
     * Get a tool by name
     */
    getTool(name: string): ToolRegistryEntry | undefined {
        return this.tools.get(name);
    }

    /**
     * Get tool by name, throw error if not found
     */
    getToolOrThrow(name: string): ToolRegistryEntry {
        const entry = this.tools.get(name);
        if (!entry) {
            throw new Error(`Tool '${name}' not found in registry`);
        }
        return entry;
    }

    /**
     * Query tools by various criteria
     */
    queryTools(options: ToolQueryOptions): ToolRegistryEntry[] {
        let results = Array.from(this.tools.values());

        // Filter by layer
        if (options.layer) {
            const layers = Array.isArray(options.layer) ? options.layer : [options.layer];
            results = results.filter(entry => layers.includes(entry.metadata.layer));
        }

        // Filter by severity
        if (options.severity) {
            const severities = Array.isArray(options.severity) ? options.severity : [options.severity];
            results = results.filter(entry => severities.includes(entry.metadata.severity));
        }

        // Filter by tags
        if (options.tags && options.tags.length > 0) {
            results = results.filter(entry =>
                options.tags!.some(tag => entry.metadata.tags?.includes(tag))
            );
        }

        // Filter by availability
        if (options.available !== undefined) {
            results = results.filter(entry => entry.metadata.isAvailable !== !options.available);
        }

        // Filter by experimental status
        if (options.experimental !== undefined) {
            results = results.filter(entry => (entry.metadata.isExperimental ?? false) === options.experimental);
        }

        return results;
    }

    /**
     * Get all tools for a specific layer
     */
    getToolsByLayer(layer: ModelingLayer): ToolRegistryEntry[] {
        const toolNames = this.layerIndex.get(layer);
        if (!toolNames) {
            return [];
        }
        return Array.from(toolNames)
            .map(name => this.tools.get(name))
            .filter((entry): entry is ToolRegistryEntry => entry !== undefined);
    }

    /**
     * Get all tools with a specific tag
     */
    getToolsByTag(tag: string): ToolRegistryEntry[] {
        const toolNames = this.tagIndex.get(tag);
        if (!toolNames) {
            return [];
        }
        return Array.from(toolNames)
            .map(name => this.tools.get(name))
            .filter((entry): entry is ToolRegistryEntry => entry !== undefined);
    }

    /**
     * Get all registered tools
     */
    getAllTools(): ToolRegistryEntry[] {
        return Array.from(this.tools.values());
    }

    /**
     * Get tool count
     */
    getToolCount(): number {
        return this.tools.size;
    }

    /**
     * Get count by layer
     */
    getCountByLayer(): Record<ModelingLayer, number> {
        const result: Record<ModelingLayer, number> = {
            core: 0,
            vocabulary: 0,
            description: 0,
            axiom: 0,
            methodology: 0,
            query: 0,
            utility: 0,
        };

        for (const [layer, tools] of this.layerIndex) {
            result[layer] = tools.size;
        }

        return result;
    }

    /**
     * Record tool usage
     */
    recordUsage(toolName: string): void {
        const entry = this.tools.get(toolName);
        if (entry) {
            entry.lastUsed = new Date();
            entry.usageCount = (entry.usageCount ?? 0) + 1;
        }
    }

    /**
     * Get most recently used tools
     */
    getMostRecentlyUsed(count: number = 10): ToolRegistryEntry[] {
        return Array.from(this.tools.values())
            .filter(entry => entry.lastUsed)
            .sort((a, b) => (b.lastUsed?.getTime() ?? 0) - (a.lastUsed?.getTime() ?? 0))
            .slice(0, count);
    }

    /**
     * Get most frequently used tools
     */
    getMostFrequentlyUsed(count: number = 10): ToolRegistryEntry[] {
        return Array.from(this.tools.values())
            .sort((a, b) => (b.usageCount ?? 0) - (a.usageCount ?? 0))
            .slice(0, count);
    }

    /**
     * Clear all tools (mainly for testing)
     */
    clear(): void {
        this.tools.clear();
        for (const toolSet of this.layerIndex.values()) {
            toolSet.clear();
        }
        this.tagIndex.clear();
    }

    /**
     * Validate metadata structure
     */
    private validateMetadata(metadata: ToolMetadata): void {
        if (!metadata.id || typeof metadata.id !== 'string') {
            throw new Error('Tool metadata must have a non-empty id (string)');
        }
        if (!metadata.description || typeof metadata.description !== 'string') {
            throw new Error('Tool metadata must have a non-empty description (string)');
        }
        if (!['core', 'vocabulary', 'description', 'axiom', 'methodology', 'query', 'utility'].includes(metadata.layer)) {
            throw new Error(`Invalid layer: ${metadata.layer}`);
        }
        if (!['critical', 'high', 'medium', 'low', 'info'].includes(metadata.severity)) {
            throw new Error(`Invalid severity: ${metadata.severity}`);
        }
    }

    /**
     * Convert tool name to display name
     * Example: create_concept → Create Concept
     */
    private toDisplayName(name: string): string {
        return name
            .split('_')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    }
}

// Global singleton instance
let registryInstance: ToolRegistry | null = null;

/**
 * Get the global tool registry instance
 */
export function getToolRegistry(): ToolRegistry {
    if (!registryInstance) {
        registryInstance = new ToolRegistry();
    }
    return registryInstance;
}

/**
 * Reset registry (mainly for testing)
 */
export function resetToolRegistry(): void {
    if (registryInstance) {
        registryInstance.clear();
    }
    registryInstance = new ToolRegistry();
}

export { ToolRegistry };
