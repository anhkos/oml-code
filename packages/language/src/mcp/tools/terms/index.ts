import type { ToolRegistration } from '../types.js';
import { createAspectHandler, createAspectTool, createAspectMetadata } from './create-aspect.js';
import { createConceptTool, createConceptMetadata } from './create-concept.js';
import { createConceptAstHandler } from './ast-create-concept.js';
import { createRelationEntityHandler, createRelationEntityTool, createRelationEntityMetadata } from './create-relation-entity.js';
import { createScalarHandler, createScalarTool, createScalarMetadata } from './create-scalar.js';
import { createScalarPropertyHandler, createScalarPropertyTool, createScalarPropertyMetadata } from './create-scalar-property.js';
import { createAnnotationPropertyHandler, createAnnotationPropertyTool, createAnnotationPropertyMetadata } from './create-annotation-property.js';
import { createRelationHandler, createRelationTool, createRelationMetadata } from './create-relation.js';
import { deleteTermHandler, deleteTermTool } from './delete-term.js';
import { updateTermHandler, updateTermTool } from './update-term.js';

// AST-based alternative handler (mutates AST then serializes via printer)
export { createConceptAstHandler } from './ast-create-concept.js';
export { printVocabulary, printConcept } from './oml-printer.js';

export const termTools: ToolRegistration[] = [
    { tool: createAspectTool, handler: createAspectHandler, metadata: createAspectMetadata },
    { tool: createConceptTool, handler: createConceptAstHandler, metadata: createConceptMetadata },
    { tool: createRelationTool, handler: createRelationHandler, metadata: createRelationMetadata },
    { tool: createRelationEntityTool, handler: createRelationEntityHandler, metadata: createRelationEntityMetadata },
    { tool: createScalarTool, handler: createScalarHandler, metadata: createScalarMetadata },
    { tool: createScalarPropertyTool, handler: createScalarPropertyHandler, metadata: createScalarPropertyMetadata },
    { tool: createAnnotationPropertyTool, handler: createAnnotationPropertyHandler, metadata: createAnnotationPropertyMetadata },
    { tool: deleteTermTool, handler: deleteTermHandler },
    { tool: updateTermTool, handler: updateTermHandler },
];
