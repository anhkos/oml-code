import type { ToolRegistration } from '../types.js';
import { createConceptInstanceHandler, createConceptInstanceTool, createConceptInstanceMetadata } from './create-concept-instance.js';
import { createRelationInstanceHandler, createRelationInstanceTool, createRelationInstanceMetadata } from './create-relation-instance.js';
import { deleteInstanceHandler, deleteInstanceTool, deleteInstanceMetadata } from './delete-instance.js';
import { updateInstanceHandler, updateInstanceTool, updateInstanceMetadata } from './update-instance.js';
import { updatePropertyValueHandler, updatePropertyValueTool, updatePropertyValueMetadata } from './update-property-value.js';
import { deletePropertyValueHandler, deletePropertyValueTool, deletePropertyValueMetadata } from './delete-property-value.js';
import { deleteTypeAssertionHandler, deleteTypeAssertionTool, deleteTypeAssertionMetadata } from './delete-type-assertion.js';

export const instanceTools: ToolRegistration[] = [
    { tool: createConceptInstanceTool, handler: createConceptInstanceHandler, metadata: createConceptInstanceMetadata },
    { tool: createRelationInstanceTool, handler: createRelationInstanceHandler, metadata: createRelationInstanceMetadata },
    { tool: deleteInstanceTool, handler: deleteInstanceHandler, metadata: deleteInstanceMetadata },
    { tool: updateInstanceTool, handler: updateInstanceHandler, metadata: updateInstanceMetadata },
    { tool: updatePropertyValueTool, handler: updatePropertyValueHandler, metadata: updatePropertyValueMetadata },
    { tool: deletePropertyValueTool, handler: deletePropertyValueHandler, metadata: deletePropertyValueMetadata },
    { tool: deleteTypeAssertionTool, handler: deleteTypeAssertionHandler, metadata: deleteTypeAssertionMetadata },
];
