import { setPreferencesTool, setPreferencesHandler } from './set-preferences-tool.js';
import { getPreferencesTool, getPreferencesHandler } from './get-preferences-tool.js';
import { logFeedbackTool, logFeedbackHandler } from './log-feedback-tool.js';

export const preferencesTools = [
    { tool: setPreferencesTool, handler: setPreferencesHandler },
    { tool: getPreferencesTool, handler: getPreferencesHandler },
    { tool: logFeedbackTool, handler: logFeedbackHandler },
];
