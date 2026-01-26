import type { ToolRegistration } from '../types.js';
import { createOntologyHandler, createOntologyTool } from './create-ontology.js';
import { addImportHandler, addImportTool } from './add-import.js';
import { deleteImportHandler, deleteImportTool } from './delete-import.js';
import { deleteOntologyHandler, deleteOntologyTool } from './delete-ontology.js';

export const ontologyTools: ToolRegistration[] = [
    { tool: createOntologyTool, handler: createOntologyHandler },
    { tool: addImportTool, handler: addImportHandler },
    { tool: deleteImportTool, handler: deleteImportHandler },
    { tool: deleteOntologyTool, handler: deleteOntologyHandler },
];
