import { z } from 'zod';
import { preferencesState } from './preferences-state.js';

const setPreferencesSchema = {
    autonomy: z.enum(['confirm', 'batch', 'auto']).optional().describe('Autonomy mode: confirm (ask before each tool), batch (ask once for plan), auto (execute with validation)'),
    workflowMode: z.enum(['basic', 'methodology']).optional().describe('Workflow mode: basic (core OML operations only) or methodology (enables methodology-editing tools)'),
    policies: z.array(z.string()).optional().describe('User policies like "never add imports automatically", "prefer reusing existing concepts", etc.'),
    safeMode: z.boolean().optional().describe('Enable safe mode to automatically validate OML after mutations. Recommended for ensuring code correctness. When enabled, mutation tools will run validation and report any errors.'),
};

export const setPreferencesTool = {
    name: 'set_preferences' as const,
    description: 'Configure user preferences for tool execution and planning. Sets autonomy mode, workflow mode, safe mode, and optional policies that guide how the agent uses tools. Use workflow mode to dynamically enable methodology-editing tools only when needed. Enable safeMode for automatic validation after mutations - recommended for catching errors early.',
    paramsSchema: setPreferencesSchema,
};

export const setPreferencesHandler = async (
    params: { autonomy?: 'confirm' | 'batch' | 'auto'; workflowMode?: 'basic' | 'methodology'; policies?: string[]; safeMode?: boolean }
): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
    try {
        preferencesState.setPreferences(params);

        const contextPrompt = preferencesState.getContextPrompt();

        return {
            content: [
                {
                    type: 'text' as const,
                    text: `✓ Preferences updated\n\n${contextPrompt}`,
                },
            ],
        };
    } catch (error) {
        return {
            content: [
                {
                    type: 'text' as const,
                    text: `Error setting preferences: ${error instanceof Error ? error.message : String(error)}`,
                },
            ],
        };
    }
};
