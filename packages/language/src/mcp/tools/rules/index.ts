import type { ToolRegistration } from '../types.js';
import { createRuleHandler, createRuleTool } from './create-rule.js';
import { deleteRuleHandler, deleteRuleTool } from './delete-rule.js';
import { updateRuleHandler, updateRuleTool } from './update-rule.js';

export const ruleTools: ToolRegistration[] = [
    { tool: createRuleTool, handler: createRuleHandler },
    { tool: deleteRuleTool, handler: deleteRuleHandler },
    { tool: updateRuleTool, handler: updateRuleHandler },
];
