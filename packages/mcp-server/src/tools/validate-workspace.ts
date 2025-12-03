import fs from "node:fs";
import path from "node:path";
import { URI } from "langium";
import type { Diagnostic } from "vscode-languageserver-types";
import { getOmlSharedServices, log, isWorkspaceInitialized, getWorkspaceRoot } from "../utils/oml-context.js";
import type { ValidationResult, ValidationError } from "./validate.js";


export function findOmlFiles(rootPath: string): string[] {
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

export async function validateOmlWithWorkspace(args: {
  uri: string;
  workspaceRoot: string;
}): Promise<ValidationResult> {
  const { uri, workspaceRoot } = args;

  try {
    const shared = getOmlSharedServices();
    const docs = shared.workspace.LangiumDocuments;
    const builder = shared.workspace.DocumentBuilder;

    const mainUri = uri.startsWith("file://") ? URI.parse(uri) : URI.file(uri);

    log("info", "validate_oml_workspace", {
      uri: mainUri.toString(),
      workspaceRoot,
    });

    const allOmlFiles = findOmlFiles(workspaceRoot);
    const uris = allOmlFiles.map((f) => URI.file(f));

    const documents = await Promise.all(
      uris.map((u) => docs.getOrCreateDocument(u))
    );

    await builder.build(documents, { validation: true });

    const mainDoc = documents.find(
      (d) => d.uri.toString() === mainUri.toString()
    );

    if (!mainDoc) {
      return {
        valid: false,
        errors: [
          {
            line: 0,
            column: 0,
            message: "Main document not found in workspace build",
            severity: "error",
          },
        ],
      };
    }

    const diagnostics: Diagnostic[] = (mainDoc.diagnostics ?? []) as Diagnostic[];
    const errors: ValidationError[] = diagnostics.map((d) => ({
      line: d.range.start.line + 1,
      column: d.range.start.character + 1,
      message: d.message,
      severity:
        d.severity === 1
          ? "error"
          : d.severity === 2
          ? "warning"
          : "info",
    }));

    return {
      valid: errors.length === 0,
      errors,
    };
  } catch (err) {
    log("error", "validate_oml_workspace error", { error: String(err) });
    return {
      valid: false,
      errors: [
        {
          line: 0,
          column: 0,
          message: `Workspace validation failed: ${String(err)}`,
          severity: "error",
        },
      ],
    };
  }
}

export async function getDiagnostics(args: { uri: string }): Promise<{
  diagnostics: Diagnostic[];
  workspaceInitialized: boolean;
  workspaceRoot: string | null;
  hint?: string;
}> {
  const { uri } = args;
  const shared = getOmlSharedServices();
  const docs = shared.workspace.LangiumDocuments;
  
  const workspaceInitialized = isWorkspaceInitialized();
  const workspaceRoot = getWorkspaceRoot();
  
  // print URI of the first document for debugging
  log("debug", "Available documents", { documentUris: docs.all.map(d => d.uri.toString()) });

  const decodedUri = decodeURIComponent(uri);
  const documentUri = decodedUri.startsWith("file://") ? URI.parse(decodedUri) : URI.file(decodedUri);
  const doc = docs.getDocument(documentUri);
  log("info", "get_diagnostics called", { uri: documentUri.toString(), workspaceInitialized });

  if (!doc) {
    log("info", "Document not found for URI", { uri: documentUri.toString() });

    return {
      diagnostics: [],
      workspaceInitialized,
      workspaceRoot,
      hint: workspaceInitialized 
        ? "Document not found. Make sure the file path is correct and exists in the workspace."
        : "Workspace not initialized! Call initialize_workspace first to load all OML files.",
    };
  }

  log("info", "diagnostics retrieved", { diagnostics: doc.diagnostics ?? [] });
  return {
    diagnostics: (doc.diagnostics ?? []) as Diagnostic[],
    workspaceInitialized,
    workspaceRoot,
  };
}
