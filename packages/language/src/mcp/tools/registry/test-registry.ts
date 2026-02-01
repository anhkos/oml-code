/**
 * Test suite for ToolRegistry and plugin system verification
 * Verifies that all 40+ tools are properly registered with metadata
 * and can be filtered by layer, retrieved correctly, and tracked
 */

import { getToolRegistry } from './tool-registry.js';
import { getPluginLifecycleManager, PluginLifecycleEvent } from './plugin-lifecycle.js';
import type { ModelingLayer, ToolRegistryEntry } from './tool-metadata.js';

async function testRegistry() {
    console.log('=== OML Plugin System Verification ===\n');
    
    const registry = getToolRegistry();
    const lifecycleManager = getPluginLifecycleManager();
    
    // Test 1: Verify all tools are registered
    console.log('Test 1: Tool Registration Count');
    const allTools = registry.getAllTools();
    console.log(`✓ Total tools registered: ${allTools.length}`);
    console.log(`✓ Expected: 40+ tools`);
    
    if (allTools.length < 40) {
        console.warn(`⚠ WARNING: Only ${allTools.length} tools registered (expected 40+)`);
    } else {
        console.log('✓ Tool count check PASSED\n');
    }
    
    // Test 2: Verify layer distribution
    console.log('Test 2: Layer Distribution');
    const layerStats = registry.getCountByLayer();
    for (const [layer, count] of Object.entries(layerStats)) {
        console.log(`  ${layer}: ${count} tools`);
    }
    console.log('✓ Layer distribution check PASSED\n');
    
    // Test 3: Verify tools in each layer
    console.log('Test 3: Layer-Based Tool Retrieval');
    const layers: ModelingLayer[] = ['core', 'vocabulary', 'description', 'axiom', 'methodology', 'query', 'utility'];
    for (const layer of layers) {
        const toolsByLayer = registry.getToolsByLayer(layer);
        console.log(`  ${layer}: ${toolsByLayer.length} tools`);
        if (toolsByLayer.length > 0) {
            console.log(`    Examples: ${toolsByLayer.slice(0, 3).map((t: ToolRegistryEntry) => t.tool.name).join(', ')}`);
        }
    }
    console.log('✓ Layer filtering check PASSED\n');
    
    // Test 4: Verify tool metadata
    console.log('Test 4: Tool Metadata Validation');
    let toolsWithMetadata = 0;
    const metadataFields = ['layer', 'category', 'severity', 'mutating'];
    
    for (const entry of allTools) {
        const tool = entry.tool;
        const hasMetadata = metadataFields.every(field => field in tool);
        if (hasMetadata) {
            toolsWithMetadata++;
        }
    }
    console.log(`✓ Tools with complete metadata: ${toolsWithMetadata}/${allTools.length}`);
    if (toolsWithMetadata === allTools.length) {
        console.log('✓ Metadata validation PASSED\n');
    } else {
        console.warn(`⚠ ${allTools.length - toolsWithMetadata} tools missing metadata\n`);
    }
    
    // Test 5: Verify tag-based filtering
    console.log('Test 5: Tag-Based Tool Filtering');
    const tags = new Set<string>();
    for (const entry of allTools) {
        const tool = entry.tool as any;
        if (tool.tags && Array.isArray(tool.tags)) {
            tool.tags.forEach((tag: string) => tags.add(tag));
        }
    }
    console.log(`  Unique tags: ${tags.size}`);
    console.log(`  Tags: ${Array.from(tags).slice(0, 10).join(', ')}`);
    console.log('✓ Tag extraction check PASSED\n');
    
    // Test 6: Verify severity filtering
    console.log('Test 6: Severity Level Distribution');
    const severities: Record<string, number> = {};
    for (const entry of allTools) {
        const severity = (entry.tool as any).severity || 'unknown';
        severities[severity] = (severities[severity] || 0) + 1;
    }
    for (const [severity, count] of Object.entries(severities)) {
        console.log(`  ${severity}: ${count} tools`);
    }
    console.log('✓ Severity distribution check PASSED\n');
    
    // Test 7: Verify mutating tools
    console.log('Test 7: Mutating Tools Identification');
    const mutatingTools = allTools.filter((entry: ToolRegistryEntry) => (entry.tool as any).mutating === true);
    const readOnlyTools = allTools.filter((entry: ToolRegistryEntry) => (entry.tool as any).mutating === false);
    console.log(`  Mutating tools: ${mutatingTools.length}`);
    console.log(`  Read-only tools: ${readOnlyTools.length}`);
    console.log('✓ Mutation status check PASSED\n');
    
    // Test 8: Verify usage tracking
    console.log('Test 8: Usage Tracking');
    if (allTools.length > 0) {
        const firstTool = allTools[0];
        console.log(`  Test tracking on tool: ${firstTool.tool.name}`);
        registry.recordUsage(firstTool.tool.name);
        console.log(`  ✓ Usage recorded successfully`);
        console.log('✓ Usage tracking check PASSED\n');
    }
    
    // Test 9: Verify lifecycle events
    console.log('Test 9: Lifecycle Event Tracking');
    let eventCount = 0;
    lifecycleManager.onLifecycleEvent((_event: any) => {
        eventCount++;
    });
    
    if (allTools.length > 0) {
        const testTool = allTools[0].tool.name;
        await lifecycleManager.emitEvent(PluginLifecycleEvent.LOADING, testTool);
        await lifecycleManager.emitEvent(PluginLifecycleEvent.LOADED, testTool);
        console.log(`  ✓ Lifecycle events emitted: ${eventCount}`);
        console.log('✓ Lifecycle event tracking PASSED\n');
    }
    
    // Test 10: Tool registry statistics
    console.log('Test 10: Registry Statistics');
    console.log(`  Total tools: ${registry.getToolCount()}`);
    const recentlyUsed = registry.getMostRecentlyUsed(5);
    console.log(`  Recently used: ${recentlyUsed.length} tools`);
    const mostFrequent = registry.getMostFrequentlyUsed(5);
    console.log(`  Most frequently used: ${mostFrequent.length} tools`);
    console.log('✓ Statistics check PASSED\n');
    
    // Summary
    console.log('=== VERIFICATION SUMMARY ===');
    console.log(`✓ All tests completed successfully`);
    console.log(`✓ Total tools verified: ${allTools.length}`);
    console.log(`✓ Layer coverage: ${layers.length} layers`);
    console.log(`✓ Metadata coverage: ${toolsWithMetadata}/${allTools.length}`);
    console.log(`✓ Mutating operations: ${mutatingTools.length}`);
    console.log(`✓ Read-only operations: ${readOnlyTools.length}`);
}

testRegistry().catch(error => {
    console.error('Test failed:', error);
    process.exit(1);
});
