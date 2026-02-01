import type { ToolRegistration } from '../types.js';
import { createOntologyHandler, createOntologyTool, createOntologyMetadata } from './create-ontology.js';
import { addImportHandler, addImportTool, addImportMetadata } from './add-import.js';
import { deleteImportHandler, deleteImportTool, deleteImportMetadata } from './delete-import.js';
import { deleteOntologyHandler, deleteOntologyTool, deleteOntologyMetadata } from './delete-ontology.js';
import { applyTextEditHandler, applyTextEditTool, applyTextEditMetadata } from './apply-text-edit.js';

export const ontologyTools: ToolRegistration[] = [
    { tool: createOntologyTool, handler: createOntologyHandler, metadata: createOntologyMetadata },
    { tool: addImportTool, handler: addImportHandler, metadata: addImportMetadata },
    { tool: deleteImportTool, handler: deleteImportHandler, metadata: deleteImportMetadata },
    { tool: deleteOntologyTool, handler: deleteOntologyHandler, metadata: deleteOntologyMetadata },
    { tool: applyTextEditTool, handler: applyTextEditHandler, metadata: applyTextEditMetadata },
];
