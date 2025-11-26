#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { validateOml } from "./tools/validate.js";
import { generateDiagram } from "./tools/diagram.js";
import {
  getTemplate,
  listTemplates,
  type TemplateKey,
} from "./tools/template.js";
import { log } from "./utils/oml-context.js";

const server = new Server(
  { name: "oml-mcp-server", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  log("info", "tools/list");

  return {
    tools: [
      {
        name: "validate_oml",
        description:
          "Validate OML file.",
        inputSchema: {
          type: "object",
          properties: {
            uri: {
              type: "string",
              description: "URI of the OML document to validate.",
            },
          },
          required: ["uri"],
        },
      },
      {
        name: "generate_diagram",
        description:
          "Compute the OML diagram model (nodes and edges) for the given code.",
        inputSchema: {
          type: "object",
          properties: {
            code: {
              type: "string",
              description: "Valid OML source text",
            },
          },
          required: ["code"],
        },
      },
      {
        name: "get_oml_template",
        description: "Return an OML snippet template by type.",
        inputSchema: {
          type: "object",
          properties: {
            templateType: {
              type: "string",
              enum: listTemplates(),
              description: "Template to generate",
            },
          },
          required: ["templateType"],
        },
      },
      {
        name: "list_concepts",
        description: "Extract and list all concept names from OML code.",
        inputSchema: {
          type: "object",
          properties: {
            code: {
              type: "string",
              description: "OML source text to analyze",
            },
          },
          required: ["code"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  log("info", "tools/call", { name, args });

  if (name === "validate_oml") {
    const { uri } = (args ?? {}) as { uri: string };
    const result = await validateOml({ uri });
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }

  if (name === "generate_diagram") {
    const { code } = (args ?? {}) as { code: string };
    const model = await generateDiagram(code);
    return {
      content: [{ type: "text", text: JSON.stringify(model, null, 2) }],
    };
  }

  if (name === "get_oml_template") {
    const { templateType } = (args ?? {}) as { templateType: TemplateKey };
    const tpl = getTemplate(templateType);
    return { content: [{ type: "text", text: tpl }] };
  }

  if (name === "list_concepts") {
    const { code } = (args ?? {}) as { code: string };
    log("info", "list_concepts called", { codeLength: code.length });
    
    const conceptMatches = code.match(/\bconcept\s+(\w+)/g) || [];
    const concepts = conceptMatches.map(match => match.replace(/^concept\s+/, ''));
    
    const result = {
      count: concepts.length,
      concepts: concepts
    };
    
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }

  throw new Error(`Unknown tool: ${name}`);
});

const transport = new StdioServerTransport();
await server.connect(transport);
log("info", "oml-mcp-server started");
