#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { validateOmlTool, validateOmlHandler } from './validate-tool.js';

async function main() {
    // Create MCP server
    const server = new McpServer({
        name: 'oml-mcp-server',
        version: '0.1.0',
    });

    // Register validate tool
    // @ts-expect-error - MCP SDK type instantiation issue
    server.tool(
        validateOmlTool.name,
        validateOmlTool.description,
        validateOmlTool.paramsSchema,
        validateOmlHandler
    );

    // Start the server
    const transport = new StdioServerTransport();
    await server.connect(transport);

    console.error('OML MCP Server running on stdio');
}

main().catch((error) => {
    console.error('Server error:', error);
    process.exit(1);
});
