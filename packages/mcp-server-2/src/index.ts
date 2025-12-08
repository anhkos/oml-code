#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListRootsResultSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { getDiagnostics } from "./tools/validate-workspace.js";
import {
  getTemplate,
  listTemplates,
  type TemplateKey,
} from "./tools/template.js";
import { log, initializeWorkspace, isWorkspaceInitialized } from "./utils/oml-context.js";

const server = new Server(
  { name: "oml-mcp-server", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

/**
 * Try to get workspace roots from the MCP client.
 * Returns null if the client doesn't support roots.
 */
async function getClientRoots(): Promise<string[] | null> {
  try {
    const response = await server.request(
      { method: "roots/list" },
      ListRootsResultSchema
    );
    if (response?.roots && Array.isArray(response.roots)) {
      return response.roots
        .map((r) => {
          // Convert file:// URI to path
          if (r.uri.startsWith("file://")) {
            // Handle both Unix and Windows paths
            const path = r.uri.replace("file://", "");
            // Windows: file:///C:/path -> C:/path
            if (path.match(/^\/[A-Za-z]:\//)) {
              return decodeURIComponent(path.slice(1)).replace(/\//g, "\\");
            }
            // Unix: file:///path -> /path
            return decodeURIComponent(path);
          }
          return r.uri;
        })
        .filter(Boolean);
    }
  } catch (err) {
    log("debug", "Client does not support roots capability", { error: String(err) });
  }
  return null;
}

/**
 * Auto-initialize workspace from client roots if available and not already initialized.
 */
async function autoInitFromClientRoots(): Promise<boolean> {
  if (isWorkspaceInitialized()) {
    return true;
  }
  
  const roots = await getClientRoots();
  if (roots && roots.length > 0) {
    log("info", "Auto-initializing from client roots", { roots });
    try {
      await initializeWorkspace(roots[0]);
      return true;
    } catch (err) {
      log("error", "Failed to auto-initialize from client roots", { error: String(err) });
    }
  }
  return false;
}

server.setRequestHandler(ListToolsRequestSchema, async () => {
  log("info", "tools/list");

  return {
    tools: [
      {
        name: "initialize_workspace",
        description: `Initialize the OML workspace by loading and indexing all .oml files in a directory.

CALL THIS FIRST before using validate_oml for cross-file features!

This replicates how the VS Code extension works:
1. Recursively finds all .oml files under the workspace root
2. Parses and loads all files into memory
3. Builds the cross-reference index so imports resolve correctly
4. Validates all files

After initialization, all documents are available with full cross-file context.
You only need to call this once per session (unless the workspace changes).`,
        inputSchema: {
          type: "object",
          properties: {
            workspaceRoot: {
              type: "string",
              description: "Root directory of the OML workspace (will recursively load all .oml files)",
            },
          },
          required: ["workspaceRoot"],
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
      {
        name: "validate_oml",
        description: `Validate an OML file and get any syntax/semantic errors.

Returns:
- valid: true/false
- errors: Array of {line, column, message, severity}
- summary: Human-readable summary
- referenceTemplate: (included when parser errors occur) A working OML template to compare against

WHEN YOU GET PARSER ERRORS ("Expecting token..."):
If referenceTemplate is included in the response, COMPARE the user's code against it line-by-line.
The template shows correct OML syntax. Find what's different and fix it.

Auto-loads the file if not already in workspace.`,
        inputSchema: {
          type: "object",
          properties: {
            uri: {
              type: "string",
              description: "File path or file:// URI of the OML document",
            },
          },
          required: ["uri"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  log("info", "tools/call", { name, args });

  if (name === "initialize_workspace") {
    const { workspaceRoot } = (args ?? {}) as { workspaceRoot: string };
    const result = await initializeWorkspace(workspaceRoot);
    return {
      content: [{ 
        type: "text", 
        text: JSON.stringify({
          success: true,
          message: `Workspace initialized with ${result.documentCount} OML files`,
          ...result
        }, null, 2) 
      }],
    };
  }

  if (name === "validate_oml") {
    const { uri } = (args ?? {}) as { uri: string };
    
    // Try to auto-initialize from client roots before validation
    await autoInitFromClientRoots();
    
    const result = await getDiagnostics({ uri });
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
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
