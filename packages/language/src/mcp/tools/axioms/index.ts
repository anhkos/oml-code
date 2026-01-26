import type { ToolRegistration } from '../types.js';
import { addSpecializationHandler, addSpecializationTool } from './add-specialization.js';
import { deleteSpecializationHandler, deleteSpecializationTool } from './delete-specialization.js';
import { addRestrictionHandler, addRestrictionTool } from './add-restriction.js';
import { addEquivalenceHandler, addEquivalenceTool } from './add-equivalence.js';
import { updateAnnotationHandler, updateAnnotationTool } from './update-annotation.js';
import { updateEquivalenceHandler, updateEquivalenceTool } from './update-equivalence.js';
import { updateKeyHandler, updateKeyTool } from './update-key.js';
import { updateRestrictionHandler, updateRestrictionTool } from './update-restriction.js';
import { deleteAnnotationHandler, deleteAnnotationTool } from './delete-annotation.js';
import { deleteRestrictionHandler, deleteRestrictionTool } from './delete-restriction.js';
import { deleteEquivalenceHandler, deleteEquivalenceTool } from './delete-equivalence.js';
import { deleteKeyHandler, deleteKeyTool } from './delete-key.js';

export const axiomTools: ToolRegistration[] = [
    { tool: addSpecializationTool, handler: addSpecializationHandler },
    { tool: deleteSpecializationTool, handler: deleteSpecializationHandler },
    { tool: addRestrictionTool, handler: addRestrictionHandler },
    { tool: addEquivalenceTool, handler: addEquivalenceHandler },
    { tool: updateAnnotationTool, handler: updateAnnotationHandler },
    { tool: updateEquivalenceTool, handler: updateEquivalenceHandler },
    { tool: updateKeyTool, handler: updateKeyHandler },
    { tool: updateRestrictionTool, handler: updateRestrictionHandler },
    { tool: deleteAnnotationTool, handler: deleteAnnotationHandler },
    { tool: deleteRestrictionTool, handler: deleteRestrictionHandler },
    { tool: deleteEquivalenceTool, handler: deleteEquivalenceHandler },
    { tool: deleteKeyTool, handler: deleteKeyHandler },
];
