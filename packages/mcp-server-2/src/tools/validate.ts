// src/tools/validate.ts
import fs from "node:fs";
import path from "node:path";
import { URI } from "langium";
import type { Diagnostic } from "vscode-languageserver-types";
import {
  getOmlSharedServices,
  initializeWorkspace,
  log,
} from "../utils/oml-context.js";

export interface ValidationError {
  line: number;
  column: number;
  message: string;
  severity: "error" | "warning" | "info";
  hint?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * Entry point used by the MCP server.
 * - We:
 *   - normalise it (Windows path or file://)
 *   - load ALL .oml files in the same folder into the Langium workspace
 *   - validate with full cross-file resolution
 */
export async function validateOml(args: { uri?: string }): Promise<ValidationResult> {
  try {
    const uri = args?.uri;

    if (!uri) {
      return {
        valid: false,
        errors: [
          {
            line: 0,
            column: 0,
            message:
              "validate_oml: URI is required. Pass a file path or file:// URI.",
            severity: "error",
          },
        ],
      };
    }

    const shared = getOmlSharedServices();
    const docs = shared.workspace.LangiumDocuments;
    const builder = shared.workspace.DocumentBuilder;

    let mainUri: URI;
    if (uri.startsWith("file://")) {
      mainUri = URI.parse(uri);
    } else {
      mainUri = URI.file(uri);
    }

    const mainFsPath = mainUri.fsPath;
    log("info", "validate_oml using URI", {
      uri: mainUri.toString(),
      fsPath: mainFsPath,
    });

    const source = fs.readFileSync(mainFsPath, "utf-8");

    const folder = path.dirname(mainFsPath);
    const entries = fs.readdirSync(folder);
    const uris: URI[] = [];

    for (const entry of entries) {
      if (entry.toLowerCase().endsWith(".oml")) {
        const filePath = path.join(folder, entry);
        uris.push(URI.file(filePath));
      }
    }

    log("debug", "validate_oml workspace files", {
      folder,
      count: uris.length,
    });

    const documents = await Promise.all(
      uris.map((u) => docs.getOrCreateDocument(u))
    );

    await builder.build(documents, {
      validation: true,
    });

    const mainDoc =
      docs.getDocument(mainUri) ??
      documents.find((d) => d.uri.toString() === mainUri.toString());

    if (!mainDoc) {
      log("error", "validate_oml: main document not found after build", {
        uri: mainUri.toString(),
      });
      return {
        valid: false,
        errors: [
          {
            line: 0,
            column: 0,
            message:
              "Internal error: could not locate document for requested URI after build.",
            severity: "error",
          },
        ],
      };
    }

    const diagnostics: Diagnostic[] = (mainDoc.diagnostics ??
      []) as Diagnostic[];
    log("debug", "validate_oml diagnostics", {
      count: diagnostics.length,
    });

    let errors = diagnostics.map((d) => enrichDiagnostic(d, source));

    // If we hit unresolved references, attempt a workspace init and re-validate
    if (hasUnresolvedReferences(diagnostics)) {
      const workspaceRoot = findWorkspaceRoot(mainFsPath);
      if (workspaceRoot) {
        log("info", "Unresolved refs; initializing workspace", {
          workspaceRoot,
        });

        await initializeWorkspace(workspaceRoot, true);

        const refreshedDoc =
          docs.getDocument(mainUri) ??
          documents.find((d) => d.uri.toString() === mainUri.toString());

        if (refreshedDoc) {
          const refreshedDiagnostics: Diagnostic[] = (refreshedDoc.diagnostics ??
            []) as Diagnostic[];
          const refreshedSource = fs.readFileSync(mainFsPath, "utf-8");
          errors = refreshedDiagnostics.map((d) =>
            enrichDiagnostic(d, refreshedSource)
          );
          log("debug", "Revalidated after workspace init", {
            count: refreshedDiagnostics.length,
          });
        } else {
          log("error", "validate_oml: main document missing after workspace init", {
            uri: mainUri.toString(),
          });
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  } catch (err) {
    log("error", "validate_oml failed", { error: String(err) });
    return {
      valid: false,
      errors: [
        {
          line: 0,
          column: 0,
          message: `Internal validation error: ${String(err)}`,
          severity: "error",
        },
      ],
    };
  }
}

/**
 * Turn a Langium Diagnostic into a simpler, tool-friendly structure,
 * and optionally attach a human-helpful hint.
 */
function enrichDiagnostic(
  d: Diagnostic,
  source: string
): ValidationError {
  const lineIdx = d.range.start.line;
  const colIdx = d.range.start.character;
  const lines = source.split(/\r?\n/);
  const lineText = lines[lineIdx] ?? "";
  const code = (d as any).data?.code as string | undefined;

  let hint: string | undefined;

  // Example heuristic: header parsing errors on the first line
  // Only for malformed vocabulary headers for now 
  if (code === "parsing-error" && lineIdx === 0 && /^\s*vocabulary\b/.test(lineText)) {
    const nsMatch = lineText.match(
      /vocabulary\s+<([^>]+)>\s+as\s+([A-Za-z_]\w*)/
    );
    if (nsMatch) {
      const ns = nsMatch[1];
      if (!/[#\/]$/.test(ns)) {
        hint =
          "The vocabulary namespace must end with '#' or '/', e.g.\n" +
          "  vocabulary <http://example.com/mission#> as mission {";
      } else {
        hint =
          "Check that your vocabulary header matches:\n" +
          "  vocabulary <...#> as prefix {";
      }
    } else {
      hint =
        "Your file should start with a header like:\n" +
        "  vocabulary <http://example.com/mission#> as mission {\n" +
        "or a @dc:... annotation followed by a vocabulary declaration.";
    }
  }

  return {
    line: lineIdx + 1,
    column: colIdx + 1,
    message: d.message,
    severity:
      d.severity === 1
        ? "error"
        : d.severity === 2
        ? "warning"
        : "info",
    ...(hint ? { hint } : {}),
  };
}

/**
 * Look for diagnostics that signal missing imports or unresolved references.
 */
function hasUnresolvedReferences(diagnostics: Diagnostic[]): boolean {
  return diagnostics.some((d) => {
    const msg = d.message.toLowerCase();
    return (
      msg.includes("could not resolve") ||
      msg.includes("cannot be resolved") ||
      msg.includes("could not find") ||
      msg.includes("unresolved") ||
      msg.includes("unknown namespace")
    );
  });
}

/**
 * Try to locate the workspace root by walking up the directory tree.
 * This mirrors the heuristic used in the workspace validator so build/oml deps are included.
 */
function findWorkspaceRoot(filePath: string): string | null {
  let dir = path.dirname(filePath);
  const root = path.parse(dir).root;

  while (dir !== root) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const hasGradle = entries.some(
        (e) => e.name === "build.gradle" || e.name === "build.gradle.kts"
      );
      const hasPackageJson = entries.some((e) => e.name === "package.json");
      const hasGit = entries.some((e) => e.name === ".git");

      if (hasGradle) return dir;
      if (hasGit || hasPackageJson) {
        const hasSrcOml = fs.existsSync(path.join(dir, "src", "oml"));
        const hasBuildOml = fs.existsSync(path.join(dir, "build", "oml"));
        const hasOmlDir = entries.some(
          (e) => e.isDirectory() && e.name === "oml"
        );
        if (hasSrcOml || hasBuildOml || hasOmlDir) return dir;
      }
    } catch {
      // ignore and keep walking up
    }
    dir = path.dirname(dir);
  }

  return path.dirname(filePath);
}
