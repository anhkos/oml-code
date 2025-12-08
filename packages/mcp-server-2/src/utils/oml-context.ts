import type { LangiumSharedServices } from "langium/lsp";
import { URI } from "langium";
import { NodeFileSystem } from "langium/node";
import { createOmlServices } from "oml-language";
import fs from "node:fs";
import path from "node:path";

let sharedServices: LangiumSharedServices | null = null;
let initializedWorkspaceRoot: string | null = null;

export function getOmlSharedServices(): LangiumSharedServices {
  if (!sharedServices) {
    const { shared } = createOmlServices(NodeFileSystem);
    sharedServices = shared;
  }
  return sharedServices;
}

/**
 * Find all .oml files recursively under a directory
 */
function findOmlFiles(rootPath: string): string[] {
  const results: string[] = [];

  function walk(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        walk(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".oml")) {
        results.push(fullPath);
      }
    }
  }

  walk(rootPath);
  return results;
}

/**
 * Initialize the OML workspace by loading and building all .oml files.
 * This gives you full cross-file reference resolution, just like the VS Code extension.
 * 
 * Call this once at startup or when the workspace changes.
 * 
 * @param workspaceRoot - Root directory containing .oml files
 * @param force - If true, re-initialize even if already initialized
 */
export async function initializeWorkspace(workspaceRoot: string, force = false): Promise<{
  documentCount: number;
  files: string[];
}> {
  // Skip if already initialized with the same root
  if (!force && initializedWorkspaceRoot === workspaceRoot) {
    const shared = getOmlSharedServices();
    const docs = Array.from(shared.workspace.LangiumDocuments.all);
    return {
      documentCount: docs.length,
      files: docs.map(d => d.uri.fsPath),
    };
  }

  const shared = getOmlSharedServices();
  const docs = shared.workspace.LangiumDocuments;
  const builder = shared.workspace.DocumentBuilder;

  log("info", "Initializing OML workspace", { workspaceRoot });

  // Find all .oml files
  const allOmlFiles = findOmlFiles(workspaceRoot);
  const uris = allOmlFiles.map(f => URI.file(f));

  log("info", "Found OML files", { count: allOmlFiles.length });

  // Load all documents into Langium's registry
  const documents = await Promise.all(
    uris.map(u => docs.getOrCreateDocument(u))
  );

  // Build all documents (parse, link, validate)
  // This resolves all cross-file references!
  await builder.build(documents, { validation: true });

  initializedWorkspaceRoot = workspaceRoot;

  log("info", "Workspace initialized", { 
    documentCount: documents.length,
    workspaceRoot 
  });

  return {
    documentCount: documents.length,
    files: allOmlFiles,
  };
}

/**
 * Check if the workspace has been initialized
 */
export function isWorkspaceInitialized(): boolean {
  return initializedWorkspaceRoot !== null;
}

/**
 * Get the current workspace root (if initialized)
 */
export function getWorkspaceRoot(): string | null {
  return initializedWorkspaceRoot;
}

export function log(
  level: "info" | "error" | "debug",
  message: string,
  data?: unknown
) {
  const timestamp = new Date().toISOString();
  const entry = {
    timestamp,
    level,
    message,
    ...(data ? { data } : {}),
  };
  console.error(JSON.stringify(entry));
}
