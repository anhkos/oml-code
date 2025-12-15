import type { ToolRegistration } from '../types.js';
import { createOntologyHandler, createOntologyTool } from './create-ontology.js';
import { addImportHandler, addImportTool } from './add-import.js';

export const ontologyTools: ToolRegistration[] = [
    { tool: createOntologyTool, handler: createOntologyHandler },
    { tool: addImportTool, handler: addImportHandler },
];
