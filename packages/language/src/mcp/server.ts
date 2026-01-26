#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { allTools } from './tools/index.js';
import { getWorkspaceRoot } from './tools/common.js';

async function main() {
    // Log workspace root for debugging
    const workspaceRoot = getWorkspaceRoot();
    console.error(`[oml-mcp-server] Workspace root: ${workspaceRoot}`);
    console.error(`[oml-mcp-server] OML_WORKSPACE_ROOT env: ${process.env.OML_WORKSPACE_ROOT || '(not set, using cwd)'}`);
    
    // Create MCP server
    const server = new McpServer({
        name: 'oml-mcp-server',
        version: '0.1.0',
    });

    for (const { tool, handler } of allTools) {
        server.tool(tool.name, tool.description, tool.paramsSchema as any, handler as any);
    }

    // Start the server
    const transport = new StdioServerTransport();
    await server.connect(transport);

    console.error('OML MCP Server running on stdio');
}

main().catch((error) => {
    console.error('Server error:', error);
    process.exit(1);
});
