/**
 * Tool Loader - Automatically discovers and loads tools
 * 
 * Scans the tools directory tree, validates tool exports,
 * and registers them with the tool registry.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Tool, ToolMetadata } from './tool-metadata.js';
import { getToolRegistry } from './tool-registry.js';

/**
 * Tool loader options
 */
export interface ToolLoaderOptions {
    /**
     * Root directory to scan for tools
     */
    toolsDir: string;

    /**
     * Specific layers to load (default: all layers)
     */
    layers?: string[];

    /**
     * Whether to log loading progress
     */
    verbose?: boolean;

    /**
     * Maximum depth to scan for tools
     */
    maxDepth?: number;
}

/**
 * Tool loading result
 */
export interface ToolLoadingResult {
    success: boolean;
    toolsLoaded: number;
    toolsFailed: number;
    errors: Array<{ path: string; error: string }>;
    loadedTools: string[];
    failedTools: string[];
    timeMs: number;
}

/**
 * Discover tool files in a directory
 */
function discoverToolFiles(
    dir: string,
    maxDepth: number = 5,
    currentDepth: number = 0,
    patterns: string[] = ['index.ts', '*.tool.ts']
): string[] {
    const files: string[] = [];

    if (currentDepth >= maxDepth) {
        return files;
    }

    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
            // Skip node_modules and hidden directories
            if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'core' || entry.name === 'registry') {
                continue;
            }

            const fullPath = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                // Recursively scan subdirectories
                files.push(...discoverToolFiles(fullPath, maxDepth, currentDepth + 1, patterns));
            } else if (entry.isFile()) {
                // Check if file matches patterns
                const matchesPattern = patterns.some(pattern => {
                    if (pattern.includes('*')) {
                        const regex = new RegExp(`^${pattern.replace(/\*/g, '.*')}$`);
                        return regex.test(entry.name);
                    }
                    return entry.name === pattern;
                });

                if (matchesPattern && entry.name.endsWith('.ts')) {
                    files.push(fullPath);
                }
            }
        }
    } catch (error) {
        console.warn(`Failed to scan directory ${dir}:`, error);
    }

    return files;
}

/**
 * Validate tool object structure
 */
function validateTool(tool: unknown, filePath: string): { valid: boolean; error?: string } {
    if (!tool || typeof tool !== 'object') {
        return { valid: false, error: 'Tool is not an object' };
    }

    const toolObj = tool as Record<string, unknown>;

    if (!toolObj.name || typeof toolObj.name !== 'string') {
        return { valid: false, error: 'Tool must have a name property (string)' };
    }

    if (!toolObj.description || typeof toolObj.description !== 'string') {
        return { valid: false, error: 'Tool must have a description property (string)' };
    }

    return { valid: true };
}

/**
 * Load a single tool file
 */
async function loadToolFile(
    filePath: string,
    verbose?: boolean
): Promise<{ tool?: Tool; metadata?: Partial<ToolMetadata>; error?: string }> {
    try {
        // Dynamic import with ESM support
        const moduleUrl = `file://${path.resolve(filePath)}?t=${Date.now()}`;
        const module = await import(moduleUrl);

        // Look for exported tool in common patterns
        let tool: Tool | undefined;
        let metadata: Partial<ToolMetadata> | undefined;

        // Check for named exports
        if (module.tool) {
            tool = module.tool;
            metadata = module.toolMetadata || module.metadata;
        } else if (module.createConceptTool) {
            tool = module.createConceptTool;
            metadata = module.createConceptMetadata;
        } else if (module.routeInstanceTool) {
            tool = module.routeInstanceTool;
            metadata = module.routeInstanceMetadata;
        } else {
            // Try to find any exported Tool-like object
            for (const value of Object.values(module)) {
                if (value && typeof value === 'object' && 'name' in value && 'description' in value) {
                    tool = value as Tool;
                    break;
                }
            }
        }

        if (!tool) {
            return { error: 'No tool export found in module' };
        }

        const validation = validateTool(tool, filePath);
        if (!validation.valid) {
            return { error: validation.error };
        }

        if (verbose) {
            console.log(`✓ Loaded tool: ${tool.name}`);
        }

        return { tool, metadata };
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return { error: `Failed to load tool: ${errorMsg}` };
    }
}

/**
 * Load all tools from a directory
 */
export async function loadTools(options: ToolLoaderOptions): Promise<ToolLoadingResult> {
    const startTime = Date.now();
    const registry = getToolRegistry();
    const errors: Array<{ path: string; error: string }> = [];
    const loadedTools: string[] = [];
    const failedTools: string[] = [];

    if (options.verbose) {
        console.log(`[Tool Loader] Scanning ${options.toolsDir}...`);
    }

    // Discover tool files
    const toolFiles = discoverToolFiles(options.toolsDir, options.maxDepth || 5);

    if (options.verbose) {
        console.log(`[Tool Loader] Found ${toolFiles.length} potential tool files`);
    }

    // Load each tool file
    for (const filePath of toolFiles) {
        const result = await loadToolFile(filePath, options.verbose);

        if (result.error) {
            errors.push({ path: filePath, error: result.error });
            failedTools.push(path.basename(filePath));
            continue;
        }

        if (!result.tool) {
            continue;
        }

        try {
            registry.registerTool(result.tool, filePath, result.metadata);
            loadedTools.push(result.tool.name);
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            errors.push({ path: filePath, error: errorMsg });
            failedTools.push(result.tool.name);
        }
    }

    const timeMs = Date.now() - startTime;

    if (options.verbose) {
        console.log(`[Tool Loader] ✓ Loaded ${loadedTools.length} tools in ${timeMs}ms`);
        if (errors.length > 0) {
            console.log(`[Tool Loader] ⚠ Failed to load ${errors.length} tools`);
            for (const { path: errorPath, error } of errors) {
                console.log(`  - ${errorPath}: ${error}`);
            }
        }
    }

    return {
        success: errors.length === 0,
        toolsLoaded: loadedTools.length,
        toolsFailed: failedTools.length,
        errors,
        loadedTools,
        failedTools,
        timeMs,
    };
}

/**
 * Load tools from a specific layer
 */
export async function loadToolsByLayer(
    toolsDir: string,
    layers: string[],
    verbose?: boolean
): Promise<ToolLoadingResult> {
    return loadTools({
        toolsDir,
        layers,
        verbose,
    });
}
