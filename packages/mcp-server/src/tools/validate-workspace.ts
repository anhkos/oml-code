import fs from "node:fs";
import path from "node:path";
import { URI } from "langium";
import type { Diagnostic } from "vscode-languageserver-types";
import { getOmlSharedServices, log } from "../utils/oml-context.js";
import type { ValidationResult, ValidationError } from "./validate.js";
import { getTemplate } from "./template.js";


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
  valid: boolean;
  errorCount: number;
  warningCount: number;
  errors: Array<{
    line: number;
    column: number;
    message: string;
    severity: "error" | "warning" | "info";
  }>;
  summary: string;
  referenceTemplate?: string;
  templateType?: string;
}> {
  const { uri } = args;
  const shared = getOmlSharedServices();
  const docs = shared.workspace.LangiumDocuments;
  const builder = shared.workspace.DocumentBuilder;

  const decodedUri = decodeURIComponent(uri);
  const documentUri = decodedUri.startsWith("file://") ? URI.parse(decodedUri) : URI.file(decodedUri);
  
  try {
    // Always re-read and rebuild the document to get fresh content from disk
    // This ensures we validate the current file state, not a cached version
    let doc = docs.getDocument(documentUri);
    
    if (doc) {
      // Document exists in cache — delete it and re-create to get fresh content
      await builder.update([documentUri], []);  // Remove from workspace
    }
    
    // Create fresh document from disk and build it
    doc = await docs.getOrCreateDocument(documentUri);
    await builder.build([doc], { validation: true });

    const rawDiagnostics = (doc.diagnostics ?? []) as Diagnostic[];
  
    // Convert to simplified format
    const errors = rawDiagnostics.map(d => ({
      line: d.range.start.line + 1,
      column: d.range.start.character + 1,
      message: d.message,
      severity: (d.severity === 1 ? "error" : d.severity === 2 ? "warning" : "info") as "error" | "warning" | "info"
    }));

    const errorCount = errors.filter(e => e.severity === "error").length;
    const warningCount = errors.filter(e => e.severity === "warning").length;
    const valid = errorCount === 0;

    // Generate a simple summary
    let summary: string;
    if (valid && warningCount === 0) {
      summary = "✓ No errors or warnings";
    } else if (valid) {
      summary = `✓ Valid with ${warningCount} warning(s)`;
    } else {
      summary = `✗ ${errorCount} error(s)${warningCount > 0 ? `, ${warningCount} warning(s)` : ""}`;
    }

    // If there are parser errors (cryptic "Expecting token" messages), include a reference template
    // This helps the AI compare against a working example
    const hasParserErrors = errors.some(e => 
      e.message.includes("Expecting") || 
      e.message.includes("expecting") ||
      e.message.includes("Token")
    );

    if (hasParserErrors && doc.textDocument) {
      const content = doc.textDocument.getText();
      
      // Detect what type of OML file this is and provide the right template
      let templateType: "vocabulary" | "description" | undefined;
      if (content.includes("vocabulary")) {
        templateType = "vocabulary";
      } else if (content.includes("description")) {
        templateType = "description";
      }

      if (templateType) {
        const template = getTemplate(templateType);
        return {
          valid,
          errorCount,
          warningCount,
          errors,
          summary: `${summary} — Compare your code against the reference template below to find syntax issues.`,
          referenceTemplate: template,
          templateType
        };
      }
    }

    return { valid, errorCount, warningCount, errors, summary };
  } catch (err) {
    return {
      valid: false,
      errorCount: 1,
      warningCount: 0,
      errors: [{
        line: 1,
        column: 1,
        message: `Could not load file: ${String(err)}`,
        severity: "error"
      }],
      summary: "File could not be loaded"
    };
  }
}