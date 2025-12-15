import type { ToolRegistration } from '../types.js';
import { createConceptInstanceHandler, createConceptInstanceTool } from './create-concept-instance.js';
import { createRelationInstanceHandler, createRelationInstanceTool } from './create-relation-instance.js';
import { deleteInstanceHandler, deleteInstanceTool } from './delete-instance.js';
import { updateInstanceHandler, updateInstanceTool } from './update-instance.js';
import { updatePropertyValueHandler, updatePropertyValueTool } from './update-property-value.js';

export const instanceTools: ToolRegistration[] = [
    { tool: createConceptInstanceTool, handler: createConceptInstanceHandler },
    { tool: createRelationInstanceTool, handler: createRelationInstanceHandler },
    { tool: deleteInstanceTool, handler: deleteInstanceHandler },
    { tool: updateInstanceTool, handler: updateInstanceHandler },
    { tool: updatePropertyValueTool, handler: updatePropertyValueHandler },
];
