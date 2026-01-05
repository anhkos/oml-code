/**
 * Preferences and planning context state for the MCP server.
 * Supports RLHF-style feedback collection and user-specific policies.
 */

export type AutonomyMode = 'confirm' | 'batch' | 'auto';

export interface UserPreferences {
    autonomy: AutonomyMode;
    policies?: string[];
    metadata?: Record<string, unknown>;
}

export interface FeedbackEntry {
    timestamp: string;
    toolName: string;
    params: unknown;
    outcome: 'approved' | 'rejected' | 'modified';
    userComment?: string;
    preferences: UserPreferences;
}

class PreferencesState {
    private preferences: UserPreferences = {
        autonomy: 'confirm',
        policies: [],
    };

    private feedbackLog: FeedbackEntry[] = [];

    getPreferences(): UserPreferences {
        return { ...this.preferences };
    }

    setPreferences(prefs: Partial<UserPreferences>): UserPreferences {
        this.preferences = {
            ...this.preferences,
            ...prefs,
        };
        return this.getPreferences();
    }

    logFeedback(entry: Omit<FeedbackEntry, 'timestamp' | 'preferences'>): void {
        this.feedbackLog.push({
            ...entry,
            timestamp: new Date().toISOString(),
            preferences: this.getPreferences(),
        });
    }

    getFeedbackLog(): FeedbackEntry[] {
        return [...this.feedbackLog];
    }

    clearFeedbackLog(): void {
        this.feedbackLog = [];
    }

    getContextPrompt(): string {
        const { autonomy, policies } = this.preferences;
        
        let prompt = `Current user preferences:\n`;
        prompt += `- Autonomy mode: ${autonomy}\n`;
        
        if (autonomy === 'confirm') {
            prompt += `  → Ask for confirmation before executing each tool call.\n`;
        } else if (autonomy === 'batch') {
            prompt += `  → Present a plan with all tool calls, ask for approval once, then execute.\n`;
        } else if (autonomy === 'auto') {
            prompt += `  → Execute tool calls automatically, but validate first; fall back to confirm if validation fails.\n`;
        }

        if (policies && policies.length > 0) {
            prompt += `- User policies:\n`;
            for (const policy of policies) {
                prompt += `  → ${policy}\n`;
            }
        }

        return prompt;
    }
}

// Global singleton instance
export const preferencesState = new PreferencesState();
