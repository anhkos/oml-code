import type { ToolRegistration } from '../types.js';
import { addSpecializationHandler, addSpecializationTool, addSpecializationMetadata } from './add-specialization.js';
import { deleteSpecializationHandler, deleteSpecializationTool, deleteSpecializationMetadata } from './delete-specialization.js';
import { addRestrictionHandler, addRestrictionTool, addRestrictionMetadata } from './add-restriction.js';
import { addEquivalenceHandler, addEquivalenceTool, addEquivalenceMetadata } from './add-equivalence.js';
import { updateAnnotationHandler, updateAnnotationTool, updateAnnotationMetadata } from './update-annotation.js';
import { updateEquivalenceHandler, updateEquivalenceTool, updateEquivalenceMetadata } from './update-equivalence.js';
import { updateKeyHandler, updateKeyTool, updateKeyMetadata } from './update-key.js';
import { updateRestrictionHandler, updateRestrictionTool, updateRestrictionMetadata } from './update-restriction.js';
import { deleteAnnotationHandler, deleteAnnotationTool, deleteAnnotationMetadata } from './delete-annotation.js';
import { deleteRestrictionHandler, deleteRestrictionTool, deleteRestrictionMetadata } from './delete-restriction.js';
import { deleteEquivalenceHandler, deleteEquivalenceTool, deleteEquivalenceMetadata } from './delete-equivalence.js';
import { deleteKeyHandler, deleteKeyTool, deleteKeyMetadata } from './delete-key.js';

export const axiomTools: ToolRegistration[] = [
    { tool: addSpecializationTool, handler: addSpecializationHandler, metadata: addSpecializationMetadata },
    { tool: deleteSpecializationTool, handler: deleteSpecializationHandler, metadata: deleteSpecializationMetadata },
    { tool: addRestrictionTool, handler: addRestrictionHandler, metadata: addRestrictionMetadata },
    { tool: addEquivalenceTool, handler: addEquivalenceHandler, metadata: addEquivalenceMetadata },
    { tool: updateAnnotationTool, handler: updateAnnotationHandler, metadata: updateAnnotationMetadata },
    { tool: updateEquivalenceTool, handler: updateEquivalenceHandler, metadata: updateEquivalenceMetadata },
    { tool: updateKeyTool, handler: updateKeyHandler, metadata: updateKeyMetadata },
    { tool: updateRestrictionTool, handler: updateRestrictionHandler, metadata: updateRestrictionMetadata },
    { tool: deleteAnnotationTool, handler: deleteAnnotationHandler, metadata: deleteAnnotationMetadata },
    { tool: deleteRestrictionTool, handler: deleteRestrictionHandler, metadata: deleteRestrictionMetadata },
    { tool: deleteEquivalenceTool, handler: deleteEquivalenceHandler, metadata: deleteEquivalenceMetadata },
    { tool: deleteKeyTool, handler: deleteKeyHandler, metadata: deleteKeyMetadata },
];
