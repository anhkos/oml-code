/**
 * Tool Plugin Lifecycle System
 * 
 * Defines lifecycle hooks and manages tool plugin lifecycle events:
 * - onLoad: Called when tool is loaded into registry
 * - onUnload: Called when tool is unloaded/unregistered
 * - validate: Called to validate tool is functional
 * - onEnable/onDisable: Called when tool is enabled/disabled
 */

import type { Tool, ToolMetadata } from './tool-metadata.js';

/**
 * Lifecycle hook for tool initialization
 */
export type OnLoadHook = (tool: Tool, metadata: ToolMetadata) => Promise<void> | void;

/**
 * Lifecycle hook for tool cleanup
 */
export type OnUnloadHook = (toolName: string) => Promise<void> | void;

/**
 * Lifecycle hook for tool validation
 */
export type ValidateHook = (tool: Tool, metadata: ToolMetadata) => Promise<{ valid: boolean; error?: string }> | { valid: boolean; error?: string };

/**
 * Lifecycle hook for tool enable/disable
 */
export type OnEnableHook = (toolName: string) => Promise<void> | void;
export type OnDisableHook = (toolName: string) => Promise<void> | void;

/**
 * Tool plugin interface - extended tool with lifecycle support
 */
export interface ToolPlugin extends Tool {
    /**
     * Called when tool is loaded into registry
     */
    onLoad?: OnLoadHook;

    /**
     * Called when tool is unloaded from registry
     */
    onUnload?: OnUnloadHook;

    /**
     * Validate that the tool is properly configured and functional
     */
    validate?: ValidateHook;

    /**
     * Called when tool is enabled (made available for use)
     */
    onEnable?: OnEnableHook;

    /**
     * Called when tool is disabled (removed from availability)
     */
    onDisable?: OnDisableHook;
}

/**
 * Plugin lifecycle event types
 */
export enum PluginLifecycleEvent {
    LOADING = 'LOADING',
    LOADED = 'LOADED',
    LOAD_ERROR = 'LOAD_ERROR',
    UNLOADING = 'UNLOADING',
    UNLOADED = 'UNLOADED',
    VALIDATING = 'VALIDATING',
    VALIDATED = 'VALIDATED',
    VALIDATION_ERROR = 'VALIDATION_ERROR',
    ENABLING = 'ENABLING',
    ENABLED = 'ENABLED',
    DISABLING = 'DISABLING',
    DISABLED = 'DISABLED',
}

/**
 * Plugin lifecycle event information
 */
export interface PluginLifecycleEventInfo {
    event: PluginLifecycleEvent;
    toolName: string;
    timestamp: Date;
    error?: string;
    metadata?: Record<string, unknown>;
}

/**
 * Plugin lifecycle listener/observer
 */
export type PluginLifecycleListener = (eventInfo: PluginLifecycleEventInfo) => void | Promise<void>;

/**
 * Plugin lifecycle manager - manages tool lifecycle events
 */
export class PluginLifecycleManager {
    private listeners: Set<PluginLifecycleListener> = new Set();
    private eventHistory: PluginLifecycleEventInfo[] = [];
    private maxHistorySize: number = 1000;

    /**
     * Subscribe to lifecycle events
     */
    onLifecycleEvent(listener: PluginLifecycleListener): () => void {
        this.listeners.add(listener);
        // Return unsubscribe function
        return () => {
            this.listeners.delete(listener);
        };
    }

    /**
     * Emit a lifecycle event
     */
    async emitEvent(
        event: PluginLifecycleEvent,
        toolName: string,
        error?: string,
        metadata?: Record<string, unknown>
    ): Promise<void> {
        const eventInfo: PluginLifecycleEventInfo = {
            event,
            toolName,
            timestamp: new Date(),
            error,
            metadata,
        };

        // Add to history
        this.eventHistory.push(eventInfo);
        if (this.eventHistory.length > this.maxHistorySize) {
            this.eventHistory.shift();
        }

        // Notify listeners
        for (const listener of this.listeners) {
            try {
                await Promise.resolve(listener(eventInfo));
            } catch (err) {
                console.error('Error in lifecycle listener:', err);
            }
        }
    }

    /**
     * Get event history
     */
    getEventHistory(limit?: number): PluginLifecycleEventInfo[] {
        if (limit) {
            return this.eventHistory.slice(-limit);
        }
        return [...this.eventHistory];
    }

    /**
     * Get events for a specific tool
     */
    getToolEvents(toolName: string): PluginLifecycleEventInfo[] {
        return this.eventHistory.filter(e => e.toolName === toolName);
    }

    /**
     * Clear event history
     */
    clearHistory(): void {
        this.eventHistory = [];
    }
}

/**
 * Plugin state manager - tracks enabled/disabled state of plugins
 */
export class PluginStateManager {
    private enabledTools: Set<string> = new Set();
    private toolErrors: Map<string, string> = new Map();

    /**
     * Enable a tool
     */
    enableTool(toolName: string): void {
        this.enabledTools.add(toolName);
        this.toolErrors.delete(toolName);
    }

    /**
     * Disable a tool
     */
    disableTool(toolName: string): void {
        this.enabledTools.delete(toolName);
    }

    /**
     * Check if tool is enabled
     */
    isEnabled(toolName: string): boolean {
        return this.enabledTools.has(toolName);
    }

    /**
     * Set error for tool (makes it disabled with error message)
     */
    setToolError(toolName: string, error: string): void {
        this.enabledTools.delete(toolName);
        this.toolErrors.set(toolName, error);
    }

    /**
     * Get error for tool
     */
    getToolError(toolName: string): string | undefined {
        return this.toolErrors.get(toolName);
    }

    /**
     * Clear error for tool
     */
    clearToolError(toolName: string): void {
        this.toolErrors.delete(toolName);
    }

    /**
     * Get all enabled tools
     */
    getEnabledTools(): string[] {
        return Array.from(this.enabledTools);
    }

    /**
     * Get all disabled tools
     */
    getDisabledTools(): string[] {
        // Return tools that have errors
        return Array.from(this.toolErrors.keys());
    }

    /**
     * Get state summary
     */
    getStateSummary() {
        return {
            enabled: this.enabledTools.size,
            disabled: this.toolErrors.size,
            enabledTools: Array.from(this.enabledTools),
            disabledTools: Array.from(this.toolErrors.keys()),
            errors: Object.fromEntries(this.toolErrors),
        };
    }
}

/**
 * Global lifecycle manager instance
 */
let lifecycleManagerInstance: PluginLifecycleManager | null = null;

/**
 * Get the global lifecycle manager
 */
export function getPluginLifecycleManager(): PluginLifecycleManager {
    if (!lifecycleManagerInstance) {
        lifecycleManagerInstance = new PluginLifecycleManager();
    }
    return lifecycleManagerInstance;
}

/**
 * Global state manager instance
 */
let stateManagerInstance: PluginStateManager | null = null;

/**
 * Get the global plugin state manager
 */
export function getPluginStateManager(): PluginStateManager {
    if (!stateManagerInstance) {
        stateManagerInstance = new PluginStateManager();
    }
    return stateManagerInstance;
}
