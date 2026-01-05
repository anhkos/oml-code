import { preferencesState } from './preferences-state.js';

const getPreferencesSchema = {};

export const getPreferencesTool = {
    name: 'get_preferences' as const,
    description: 'Retrieve current user preferences and planning context. Returns the active autonomy mode, policies, and a formatted prompt snippet you can use to condition your planning.',
    paramsSchema: getPreferencesSchema,
};

export const getPreferencesHandler = async (): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
    try {
        const prefs = preferencesState.getPreferences();
        const contextPrompt = preferencesState.getContextPrompt();

        return {
            content: [
                {
                    type: 'text' as const,
                    text: `Current preferences:\n\n${contextPrompt}\n\nJSON representation:\n${JSON.stringify(prefs, null, 2)}`,
                },
            ],
        };
    } catch (error) {
        return {
            content: [
                {
                    type: 'text' as const,
                    text: `Error getting preferences: ${error instanceof Error ? error.message : String(error)}`,
                },
            ],
        };
    }
};
