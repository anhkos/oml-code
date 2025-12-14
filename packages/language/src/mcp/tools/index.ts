import { validateOmlHandler, validateOmlTool } from './validate-tool.js';
import { createAspectHandler, createAspectTool } from './terms/create-aspect.js';
import { createConceptHandler, createConceptTool } from './terms/create-concept.js';
import { createRelationEntityHandler, createRelationEntityTool } from './terms/create-relation-entity.js';
import { createScalarHandler, createScalarTool } from './terms/create-scalar.js';
import { createScalarPropertyHandler, createScalarPropertyTool } from './terms/create-scalar-property.js';
import { createAnnotationPropertyHandler, createAnnotationPropertyTool } from './terms/create-annotation-property.js';
import { createUnreifiedRelationHandler, createUnreifiedRelationTool } from './terms/create-unreified-relation.js';
import { deleteTermHandler, deleteTermTool } from './terms/delete-term.js';
import { addSpecializationHandler, addSpecializationTool } from './axioms/add-specialization.js';
import { deleteSpecializationHandler, deleteSpecializationTool } from './axioms/delete-specialization.js';
import { pendingTools } from './stubs/pending-tools.js';

export type ToolRegistration = {
    tool: { name: string; description: string; paramsSchema: unknown };
    handler: (...args: any[]) => any;
};

export const phase1Tools: ToolRegistration[] = [
    { tool: validateOmlTool, handler: validateOmlHandler },
    { tool: createAspectTool, handler: createAspectHandler },
    { tool: createConceptTool, handler: createConceptHandler },
    { tool: createRelationEntityTool, handler: createRelationEntityHandler },
    { tool: createScalarTool, handler: createScalarHandler },
    { tool: createScalarPropertyTool, handler: createScalarPropertyHandler },
    { tool: createAnnotationPropertyTool, handler: createAnnotationPropertyHandler },
    { tool: createUnreifiedRelationTool, handler: createUnreifiedRelationHandler },
    { tool: deleteTermTool, handler: deleteTermHandler },
    { tool: addSpecializationTool, handler: addSpecializationHandler },
    { tool: deleteSpecializationTool, handler: deleteSpecializationHandler },
];

export const allTools: ToolRegistration[] = [...phase1Tools, ...pendingTools.map((p) => ({ tool: p.tool, handler: p.handler }))];
