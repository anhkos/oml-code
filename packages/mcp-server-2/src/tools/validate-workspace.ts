import fs from "node:fs";
import path from "node:path";
import { URI } from "langium";
import type { Diagnostic } from "vscode-languageserver-types";
import { getOmlSharedServices, log, initializeWorkspace} from "../utils/oml-context.js";
import type { ValidationResult, ValidationError } from "./validate.js";
import { getTemplate } from "./template.js";

/**
 * Try to find the OML workspace root by walking up the directory tree.
 * Looks for project root markers (package.json, build.gradle, .git) because
 * OML projects often have dependencies in build/oml that need to be included.
 * 
 * Priority:
 * 1. Project root with build.gradle or package.json (includes build/oml dependencies)
 * 2. Directory with .oml files and project structure
 * 3. Fallback to file's directory
 */
function findWorkspaceRoot(filePath: string): string | null {
  let dir = path.dirname(filePath);
  const root = path.parse(dir).root;
  
  while (dir !== root) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      
      // Check for project root markers - these indicate the true project root
      // which includes build/oml with external dependencies
      const hasGradle = entries.some(e => e.name === 'build.gradle' || e.name === 'build.gradle.kts');
      const hasPackageJson = entries.some(e => e.name === 'package.json');
      const hasGit = entries.some(e => e.name === '.git');
      
      // If we find a Gradle project, this is definitely the root
      // Gradle OML projects have dependencies downloaded to build/oml
      if (hasGradle) {
        log("info", "Found Gradle project root", { dir });
        return dir;
      }
      
      // If we find .git or package.json, check if this looks like an OML project
      if (hasGit || hasPackageJson) {
        // Check if there are OML files somewhere under this directory
        const hasSrcOml = fs.existsSync(path.join(dir, 'src', 'oml'));
        const hasBuildOml = fs.existsSync(path.join(dir, 'build', 'oml'));
        const hasOmlDir = entries.some(e => e.isDirectory() && e.name === 'oml');
        
        if (hasSrcOml || hasBuildOml || hasOmlDir) {
          log("info", "Found OML project root", { dir, hasSrcOml, hasBuildOml });
          return dir;
        }
      }
    } catch {
      // Can't read directory, keep going up
    }
    
    dir = path.dirname(dir);
  }
  
  // Fallback: use the file's directory
  return path.dirname(filePath);
}


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
  workspaceAutoInitialized?: boolean;
  workspaceRoot?: string;
}> {
  const { uri } = args;
  const shared = getOmlSharedServices();
  const docs = shared.workspace.LangiumDocuments;
  const builder = shared.workspace.DocumentBuilder;

  const decodedUri = decodeURIComponent(uri);
  const documentUri = decodedUri.startsWith("file://") ? URI.parse(decodedUri) : URI.file(decodedUri);
  const filePath = documentUri.fsPath;
  
  // Helper function to run validation and get results
  async function runValidation(): Promise<{
    errors: Array<{ line: number; column: number; message: string; severity: "error" | "warning" | "info" }>;
    doc: any;
  }> {
    const freshContent = fs.readFileSync(filePath, 'utf-8');
    let doc = docs.getDocument(documentUri);
    
    if (doc) {
      const textDoc = doc.textDocument;
      const currentContent = textDoc.getText();
      
      if (currentContent !== freshContent) {
        (textDoc as any).update([{ text: freshContent }], textDoc.version + 1);
        await builder.update([documentUri], []);
        await builder.build([doc], { validation: true });
      }
    } else {
      doc = await docs.getOrCreateDocument(documentUri);
      await builder.build([doc], { validation: true });
    }

    const rawDiagnostics = (doc.diagnostics ?? []) as Diagnostic[];
    const errors = rawDiagnostics.map(d => ({
      line: d.range.start.line + 1,
      column: d.range.start.character + 1,
      message: d.message,
      severity: (d.severity === 1 ? "error" : d.severity === 2 ? "warning" : "info") as "error" | "warning" | "info"
    }));
    
    return { errors, doc };
  }
  
  try {
    // First pass: validate the file
    let { errors, doc } = await runValidation();
    let workspaceAutoInitialized = false;
    let workspaceRoot: string | undefined;
    
    // Check if there are unresolved reference errors (likely missing workspace context)
    const hasUnresolvedRefs = errors.some(e => 
      e.message.includes("Could not resolve reference") ||
      e.message.includes("cannot be resolved") ||
      e.message.includes("Could not find")
    );
    
    // If we have unresolved refs, try to auto-initialize the workspace for this file
    // We do this even if a workspace was previously initialized, because it might be
    // a different workspace or the file might be outside the current workspace
    if (hasUnresolvedRefs) {
      const detectedRoot = findWorkspaceRoot(filePath);
      
      if (detectedRoot) {
        log("info", "Auto-initializing workspace due to unresolved references", { detectedRoot });
        
        try {
          // Force re-initialization to ensure we have the right workspace
          await initializeWorkspace(detectedRoot, true);
          workspaceAutoInitialized = true;
          workspaceRoot = detectedRoot;
          
          // Re-validate after workspace initialization
          const result = await runValidation();
          errors = result.errors;
          doc = result.doc;
        } catch (initErr) {
          log("error", "Failed to auto-initialize workspace", { error: String(initErr) });
        }
      }
    }

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
          templateType,
          ...(workspaceAutoInitialized && { workspaceAutoInitialized, workspaceRoot })
        };
      }
    }

    // Add workspace info if we auto-initialized
    if (workspaceAutoInitialized) {
      return { 
        valid, 
        errorCount, 
        warningCount, 
        errors, 
        summary: `${summary} (workspace auto-initialized from ${workspaceRoot})`,
        workspaceAutoInitialized,
        workspaceRoot
      };
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