import type { ToolRegistration } from '../types.js';
import { createRuleHandler, createRuleTool } from './create-rule.js';

export const ruleTools: ToolRegistration[] = [
    { tool: createRuleTool, handler: createRuleHandler },
];
