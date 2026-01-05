import { z } from 'zod';
import { preferencesState } from './preferences-state.js';

const logFeedbackSchema = {
    toolName: z.string().describe('Name of the tool that was executed'),
    outcome: z.enum(['approved', 'rejected', 'modified']).describe('User feedback on the tool execution'),
    userComment: z.string().optional().describe('Optional comment from user explaining their feedback'),
};

export const logFeedbackTool = {
    name: 'log_feedback' as const,
    description: 'Log user feedback on a tool execution for RLHF-style learning. Records whether the user approved, rejected, or modified the outcome, along with the current preference context. This data can be used later for preference learning or reward modeling.',
    paramsSchema: logFeedbackSchema,
};

export const logFeedbackHandler = async (
    params: { toolName: string; outcome: 'approved' | 'rejected' | 'modified'; userComment?: string }
): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
    try {
        preferencesState.logFeedback({
            toolName: params.toolName,
            params: {}, // Could be extended to capture full tool params
            outcome: params.outcome,
            userComment: params.userComment,
        });

        return {
            content: [
                {
                    type: 'text' as const,
                    text: `✓ Feedback logged for tool "${params.toolName}" (${params.outcome})`,
                },
            ],
        };
    } catch (error) {
        return {
            content: [
                {
                    type: 'text' as const,
                    text: `Error logging feedback: ${error instanceof Error ? error.message : String(error)}`,
                },
            ],
        };
    }
};
