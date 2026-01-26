import type { ToolRegistration } from '../types.js';
import { createAspectHandler, createAspectTool } from './create-aspect.js';
import { createConceptHandler, createConceptTool } from './create-concept.js';
import { createRelationEntityHandler, createRelationEntityTool } from './create-relation-entity.js';
import { createScalarHandler, createScalarTool } from './create-scalar.js';
import { createScalarPropertyHandler, createScalarPropertyTool } from './create-scalar-property.js';
import { createAnnotationPropertyHandler, createAnnotationPropertyTool } from './create-annotation-property.js';
import { createRelationHandler, createRelationTool } from './create-relation.js';
import { deleteTermHandler, deleteTermTool } from './delete-term.js';
import { updateTermHandler, updateTermTool } from './update-term.js';

export const termTools: ToolRegistration[] = [
    { tool: createAspectTool, handler: createAspectHandler },
    { tool: createConceptTool, handler: createConceptHandler },
    { tool: createRelationTool, handler: createRelationHandler },
    { tool: createRelationEntityTool, handler: createRelationEntityHandler },
    { tool: createScalarTool, handler: createScalarHandler },
    { tool: createScalarPropertyTool, handler: createScalarPropertyHandler },
    { tool: createAnnotationPropertyTool, handler: createAnnotationPropertyHandler },
    { tool: deleteTermTool, handler: deleteTermHandler },
    { tool: updateTermTool, handler: updateTermHandler },
];
