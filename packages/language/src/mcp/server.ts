#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { allTools, methodologyModeToolNames } from './tools/index.js';
import { getWorkspaceRoot } from './tools/common.js';
import { createToolRegistry, createPluginLifecycleManager, type Tool } from './tools/registry/index.js';
import { preferencesState } from './tools/preferences/preferences-state.js';

/**
 * Initialize and register all tools with the registry
 */
async function initializeToolRegistry() {
    const registry = await createToolRegistry();
    
    // Register all tools with their metadata
    for (const toolReg of allTools) {
        registry.registerTool(
            toolReg.tool as Tool,
            toolReg.tool.name,
            toolReg.metadata
        );
    }
    
    return registry;
}

/**
 * Main server initialization with plugin lifecycle management
 */
async function main() {
    // Log workspace root for debugging
    const workspaceRoot = getWorkspaceRoot();
    console.error(`[oml-mcp-server] Workspace root: ${workspaceRoot}`);
    console.error(`[oml-mcp-server] OML_WORKSPACE_ROOT env: ${process.env.OML_WORKSPACE_ROOT || '(not set, using cwd)'}`);
    
    // Initialize tool registry
    const registry = await initializeToolRegistry();
    
    // Initialize plugin lifecycle manager
    const lifecycleManager = await createPluginLifecycleManager();
    
    // Log registry stats
    console.error(`[oml-mcp-server] Tool registry initialized with ${registry.getToolCount()} tools`);
    const layerStats = registry.getCountByLayer();
    for (const [layer, count] of Object.entries(layerStats)) {
        console.error(`[oml-mcp-server]   ${layer}: ${count} tools`);
    }
    
    // Create MCP server
    const server = new McpServer({
        name: 'oml-mcp-server',
        version: '0.1.0',
    });

    // Register all tools dynamically from registry
    const tools = registry.getAllTools();
    for (const entry of tools) {
        const { tool } = entry;
        
        // Get the handler from the allTools array to maintain closure
        const toolReg = allTools.find(t => t.tool.name === tool.name);
        if (!toolReg) continue;
        
        const handler = toolReg.handler;
        
        // Register tool with lifecycle tracking
        await lifecycleManager.emitEvent('LOADED' as any, tool.name);
        
        server.tool(
            tool.name,
            tool.description,
            tool.paramsSchema as any,
            async (...args: any[]) => {
                try {
                    const workflowMode = preferencesState.getPreferences().workflowMode ?? 'basic';
                    if (methodologyModeToolNames.has(tool.name) && workflowMode !== 'methodology') {
                        return {
                            content: [
                                {
                                    type: 'text' as const,
                                    text:
                                        `Tool '${tool.name}' is unavailable in workflow mode '${workflowMode}'.\n` +
                                        `Switch modes first:\n` +
                                        `set_preferences({ workflowMode: "methodology" })`,
                                },
                            ],
                        };
                    }

                    // Increment usage tracking
                    registry.recordUsage(tool.name);
                    
                    // Execute handler
                    const result = await handler(...args);
                    
                    // Record success
                    await lifecycleManager.emitEvent('ENABLED' as any, tool.name);
                    
                    return result;
                } catch (error) {
                    console.error(`[oml-mcp-server] Error in tool '${tool.name}':`, error);
                    await lifecycleManager.emitEvent('DISABLED' as any, tool.name, String(error));
                    throw error;
                }
            }
        );
    }

    // Start the server
    const transport = new StdioServerTransport();
    await server.connect(transport);

    console.error('OML MCP Server running on stdio');
    console.error(`[oml-mcp-server] Total tools loaded: ${tools.length}`);
}

main().catch((error) => {
    console.error('Server error:', error);
    process.exit(1);
});
