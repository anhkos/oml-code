#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { validateOmlTool, validateOmlHandler } from './tools/validate-tool.js';
import { addConceptTool, addConceptHandler } from './tools/add-concept-tool.js';

async function main() {
    // Create MCP server
    const server = new McpServer({
        name: 'oml-mcp-server',
        version: '0.1.0',
    });

    server.tool(
        validateOmlTool.name,
        validateOmlTool.description,
        validateOmlTool.paramsSchema as any,
        validateOmlHandler as any
    );

    server.tool(
        addConceptTool.name,
        addConceptTool.description,
        addConceptTool.paramsSchema as any,
        addConceptHandler as any
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
