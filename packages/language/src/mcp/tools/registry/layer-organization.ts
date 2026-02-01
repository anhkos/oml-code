/**
 * Layer-Based Tool Organization Utilities
 * 
 * Provides helpers for organizing, querying, and visualizing tools by modeling layer.
 * Enables layer-aware tool management and dependency analysis.
 */

import type { ToolRegistryEntry, ModelingLayer } from './tool-metadata.js';
import { getToolRegistry } from './tool-registry.js';

/**
 * Tool layer organization result
 */
export interface LayerOrganization {
    layer: ModelingLayer;
    count: number;
    tools: ToolRegistryEntry[];
    description: string;
}

/**
 * Layer dependency information
 */
export interface LayerDependencies {
    layer: ModelingLayer;
    dependsOn: Set<ModelingLayer>;
    dependents: Set<ModelingLayer>;
}

/**
 * Get all tools organized by layer
 */
export function getToolsByLayer(): Map<ModelingLayer, ToolRegistryEntry[]> {
    const registry = getToolRegistry();
    const layers: ModelingLayer[] = ['core', 'vocabulary', 'description', 'axiom', 'methodology', 'query', 'utility'];
    const result = new Map<ModelingLayer, ToolRegistryEntry[]>();

    for (const layer of layers) {
        result.set(layer, registry.getToolsByLayer(layer));
    }

    return result;
}

/**
 * Get organized layer information
 */
export function getLayerOrganization(): LayerOrganization[] {
    const descriptions: Record<ModelingLayer, string> = {
        core: 'Core tools for validation, querying, and analysis',
        vocabulary: 'Tools for creating and managing types (concepts, relations, scalars)',
        description: 'Tools for creating and managing instances',
        axiom: 'Tools for managing axioms (specialization, restriction, etc.)',
        methodology: 'Tools for enforcing methodology rules and guidelines',
        query: 'Tools for searching, analyzing, and querying',
        utility: 'Utility tools applicable to multiple layers',
    };

    const byLayer = getToolsByLayer();
    const result: LayerOrganization[] = [];

    for (const [layer, tools] of byLayer) {
        result.push({
            layer,
            count: tools.length,
            tools,
            description: descriptions[layer],
        });
    }

    return result;
}

/**
 * Get layer hierarchy/dependencies
 */
export function getLayerDependencies(): Map<ModelingLayer, LayerDependencies> {
    const layers: ModelingLayer[] = ['core', 'vocabulary', 'description', 'axiom', 'methodology', 'query', 'utility'];
    const result = new Map<ModelingLayer, LayerDependencies>();

    // Define known layer dependencies
    // This reflects the modeling stack: vocabulary → axiom → description → methodology
    const dependencies: Record<ModelingLayer, ModelingLayer[]> = {
        core: [],
        vocabulary: [],
        axiom: ['vocabulary'],
        description: ['vocabulary', 'axiom'],
        methodology: ['vocabulary', 'axiom', 'description'],
        query: ['vocabulary', 'description'],
        utility: [],
    };

    for (const layer of layers) {
        const deps = new Set(dependencies[layer]);
        const dependents = new Set<ModelingLayer>();

        // Find which layers depend on this one
        for (const [otherLayer, otherDeps] of Object.entries(dependencies)) {
            if (otherDeps.includes(layer)) {
                dependents.add(otherLayer as ModelingLayer);
            }
        }

        result.set(layer, {
            layer,
            dependsOn: deps,
            dependents,
        });
    }

    return result;
}

/**
 * Check if tools can be used together (dependency check)
 */
export function canUseTools(toolNames: string[]): { valid: boolean; errors: string[] } {
    const registry = getToolRegistry();
    const errors: string[] = [];

    const toolLayers = new Set<ModelingLayer>();

    // Get layers for all tools
    for (const toolName of toolNames) {
        const entry = registry.getTool(toolName);
        if (!entry) {
            errors.push(`Tool '${toolName}' not found in registry`);
            continue;
        }
        toolLayers.add(entry.metadata.layer);
    }

    // Check layer dependencies (for future use - can expand validation logic)
    getLayerDependencies();

    return {
        valid: errors.length === 0,
        errors,
    };
}

/**
 * Get layer coverage - tools available per layer
 */
export function getLayerCoverage(): Record<ModelingLayer, { count: number; percentage: number }> {
    const registry = getToolRegistry();
    const byLayer = getToolsByLayer();
    const total = registry.getToolCount();

    const result: Record<ModelingLayer, { count: number; percentage: number }> = {
        core: { count: 0, percentage: 0 },
        vocabulary: { count: 0, percentage: 0 },
        description: { count: 0, percentage: 0 },
        axiom: { count: 0, percentage: 0 },
        methodology: { count: 0, percentage: 0 },
        query: { count: 0, percentage: 0 },
        utility: { count: 0, percentage: 0 },
    };

    for (const [layer, tools] of byLayer) {
        result[layer] = {
            count: tools.length,
            percentage: total > 0 ? Math.round((tools.length / total) * 100) : 0,
        };
    }

    return result;
}

/**
 * Generate ASCII visualization of tools by layer
 */
export function visualizeLayerOrganization(): string {
    const org = getLayerOrganization();
    const lines: string[] = [];

    lines.push('╔═══════════════════════════════════════════════════════════════════╗');
    lines.push('║                    Tool Organization by Layer                    ║');
    lines.push('╠═══════════════════════════════════════════════════════════════════╣');

    for (const layer of org) {
        lines.push(`║                                                               ║`);
        lines.push(`║ 🔹 ${layer.layer.toUpperCase().padEnd(52)} (${layer.count}) │`);
        lines.push(`║   ${layer.description.padEnd(61)} │`);
        
        if (layer.tools.length > 0) {
            // Show first 3 tools
            for (let i = 0; i < Math.min(3, layer.tools.length); i++) {
                const tool = layer.tools[i];
                const name = `   • ${tool.metadata.displayName}`;
                lines.push(`║${name.padEnd(65)}│`);
            }
            if (layer.tools.length > 3) {
                lines.push(`║   ... and ${layer.tools.length - 3} more tools`.padEnd(66) + '│');
            }
        }
    }

    lines.push('╚═══════════════════════════════════════════════════════════════════╝');

    return lines.join('\n');
}

/**
 * Generate layer statistics report
 */
export function generateLayerStatistics(): string {
    const registry = getToolRegistry();
    const coverage = getLayerCoverage();
    const org = getLayerOrganization();

    const lines: string[] = [];
    lines.push('═══════════════════════════════════════════════════════════════════');
    lines.push('                    Tool Layer Statistics');
    lines.push('═══════════════════════════════════════════════════════════════════');
    lines.push('');

    lines.push(`Total Tools Registered: ${registry.getToolCount()}`);
    lines.push('');

    lines.push('Tools by Layer:');
    lines.push('');
    lines.push('┌─────────────┬───────┬────────────┐');
    lines.push('│ Layer       │ Count │ Percentage │');
    lines.push('├─────────────┼───────┼────────────┤');

    for (const layer of org) {
        const layerCov = coverage[layer.layer];
        const layerName = layer.layer.padEnd(11);
        const count = String(layer.count).padStart(5);
        const percent = `${layerCov.percentage}%`.padStart(9);
        lines.push(`│ ${layerName} │${count} │${percent} │`);
    }

    lines.push('└─────────────┴───────┴────────────┘');
    lines.push('');

    return lines.join('\n');
}

/**
 * Get tools recommended for a specific modeling layer
 */
export function getRecommendedTools(layer: ModelingLayer, limit?: number): ToolRegistryEntry[] {
    const registry = getToolRegistry();
    const tools = registry.getToolsByLayer(layer);

    // Sort by severity (critical first) and then by usage
    tools.sort((a, b) => {
        const severityOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
        const severityDiff = severityOrder[a.metadata.severity] - severityOrder[b.metadata.severity];
        if (severityDiff !== 0) return severityDiff;
        return (b.usageCount ?? 0) - (a.usageCount ?? 0);
    });

    return limit ? tools.slice(0, limit) : tools;
}
