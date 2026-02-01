import type { ToolRegistration } from '../types.js';
import { createRuleHandler, createRuleTool, createRuleMetadata } from './create-rule.js';
import { deleteRuleHandler, deleteRuleTool, deleteRuleMetadata } from './delete-rule.js';
import { updateRuleHandler, updateRuleTool, updateRuleMetadata } from './update-rule.js';

export const ruleTools: ToolRegistration[] = [
    { tool: createRuleTool, handler: createRuleHandler, metadata: createRuleMetadata },
    { tool: deleteRuleTool, handler: deleteRuleHandler, metadata: deleteRuleMetadata },
    { tool: updateRuleTool, handler: updateRuleHandler, metadata: updateRuleMetadata },
];
