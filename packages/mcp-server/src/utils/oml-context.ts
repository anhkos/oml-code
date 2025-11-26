import type { LangiumSharedServices } from "langium/lsp";
import { NodeFileSystem } from "langium/node";
import { createOmlServices } from "oml-language";

let sharedServices: LangiumSharedServices | null = null;

export function getOmlSharedServices(): LangiumSharedServices {
  if (!sharedServices) {
    const { shared } = createOmlServices(NodeFileSystem);
    sharedServices = shared;
  }
  return sharedServices;
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
