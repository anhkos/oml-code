/**
 * Tool Registry Package
 * 
 * Provides tool auto-registration, discovery, and plugin system.
 * Enables dynamic tool loading and layer-based organization.
 */

// Tool metadata types and interfaces
export type { Tool, ToolMetadata, ToolPackage, ToolRegistryEntry, ToolQueryOptions } from './tool-metadata.js';
export type { ModelingLayer, ToolSeverity } from './tool-metadata.js';

// Tool registry - central registry for all tools
export { ToolRegistry, getToolRegistry, resetToolRegistry } from './tool-registry.js';

// Tool loader - automatic tool discovery and loading
export {
    loadTools,
    loadToolsByLayer,
    type ToolLoaderOptions,
    type ToolLoadingResult,
} from './tool-loader.js';

// Plugin lifecycle system
export {
    PluginLifecycleManager,
    PluginStateManager,
    PluginLifecycleEvent,
    getPluginLifecycleManager,
    getPluginStateManager,
    type ToolPlugin,
    type OnLoadHook,
    type OnUnloadHook,
    type ValidateHook,
    type OnEnableHook,
    type OnDisableHook,
    type PluginLifecycleEventInfo,
    type PluginLifecycleListener,
} from './plugin-lifecycle.js';

// Layer-based tool organization
export {
    getToolsByLayer,
    getLayerOrganization,
    getLayerDependencies,
    canUseTools,
    getLayerCoverage,
    visualizeLayerOrganization,
    generateLayerStatistics,
    getRecommendedTools,
    type LayerOrganization,
    type LayerDependencies,
} from './layer-organization.js';

// Factory functions for convenient creation
// Note: These are async to use dynamic import() and avoid circular dependency issues
export async function createToolRegistry() {
    const { getToolRegistry } = await import('./tool-registry.js');
    return getToolRegistry();
}

export async function createPluginLifecycleManager() {
    const { getPluginLifecycleManager } = await import('./plugin-lifecycle.js');
    return getPluginLifecycleManager();
}
