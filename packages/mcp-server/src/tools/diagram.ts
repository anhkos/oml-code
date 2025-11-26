// src/tools/diagram.ts
import { URI } from "langium";
import type { LangiumSharedServices } from "langium/lsp";
import { getOmlSharedServices, log } from "../utils/oml-context.js";
// Adjust this import/alias to match your real file / export:
import { computeDiagramModel } from "oml-language";

export interface DiagramResult {
  nodes: unknown[];
  edges: unknown[];
  // add other fields if your DiagramModel has them (bounds, metadata, etc.)
}

export async function generateDiagram(code: string): Promise<DiagramResult> {
  const shared: LangiumSharedServices = getOmlSharedServices();

  log("info", "generate_diagram called", { codeLength: code.length });

  const uri = "inmemory://copilot/diagram.oml";

  try {
    // Create + build a Langium document so it’s in the workspace
    const factory = shared.workspace.LangiumDocumentFactory;
    const builder = shared.workspace.DocumentBuilder;

    const documentUri = URI.parse(uri);
    const document = factory.fromString(code, documentUri);

    await builder.build([document], { validation: false });

    log("debug", "Document built, computing diagram model");

    // This line must match your real function:
    const model = await computeDiagramModel(shared, uri);

    log("info", "Diagram generated", {
      nodeCount: (model as any).nodes?.length ?? 0,
      edgeCount: (model as any).edges?.length ?? 0,
    });

    return model as DiagramResult;
  } catch (err) {
    log("error", "generate_diagram failed", { error: String(err) });
    throw err;
  }
}
