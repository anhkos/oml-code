import type { ToolRegistration } from '../types.js';
import { createConceptInstanceHandler, createConceptInstanceTool } from './create-concept-instance.js';
import { createRelationInstanceHandler, createRelationInstanceTool } from './create-relation-instance.js';
import { deleteInstanceHandler, deleteInstanceTool } from './delete-instance.js';
import { updateInstanceHandler, updateInstanceTool } from './update-instance.js';
import { updatePropertyValueHandler, updatePropertyValueTool } from './update-property-value.js';
import { deletePropertyValueHandler, deletePropertyValueTool } from './delete-property-value.js';
import { deleteTypeAssertionHandler, deleteTypeAssertionTool } from './delete-type-assertion.js';

export const instanceTools: ToolRegistration[] = [
    { tool: createConceptInstanceTool, handler: createConceptInstanceHandler },
    { tool: createRelationInstanceTool, handler: createRelationInstanceHandler },
    { tool: deleteInstanceTool, handler: deleteInstanceHandler },
    { tool: updateInstanceTool, handler: updateInstanceHandler },
    { tool: updatePropertyValueTool, handler: updatePropertyValueHandler },
    { tool: deletePropertyValueTool, handler: deletePropertyValueHandler },
    { tool: deleteTypeAssertionTool, handler: deleteTypeAssertionHandler },
];
