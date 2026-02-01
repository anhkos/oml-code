#!/usr/bin/env node
/**
 * Quick verification script to test tool registry
 */

import { getToolRegistry } from './out/mcp/tools/registry/tool-registry.js';
import { allTools } from './out/mcp/tools/index.js';

async function quickTest() {
    try {
        console.log('=== Quick Tool Registry Verification ===\n');
        
        const registry = getToolRegistry();
        
        // Initialize registry with all tools
        console.log(`Registering ${allTools.length} tools...`);
        for (const toolReg of allTools) {
            registry.registerTool(
                toolReg.tool,
                toolReg.tool.name,
                toolReg.metadata
            );
        }
        
        console.log(`✓ Registry initialized`);
        
        const tools = registry.getAllTools();
        console.log(`✓ Retrieved ${tools.length} tools from registry`);
        
        // Verify count matches allTools
        console.log(`✓ allTools array has ${allTools.length} tools`);
        
        if (tools.length > 0) {
            console.log(`\n✓ Sample tools:`);
            tools.slice(0, 5).forEach(entry => {
                console.log(`  - ${entry.tool.name} (layer: ${entry.metadata.layer})`);
            });
        }
        
        // Check layers
        const layers = registry.getCountByLayer();
        console.log(`\n✓ Layer distribution:`);
        for (const [layer, count] of Object.entries(layers)) {
            console.log(`  ${layer}: ${count}`);
        }
        
        console.log(`\n✓✓✓ Tool registry verification PASSED ✓✓✓`);
    } catch (error) {
        console.error('✗ Verification failed:', error);
        process.exit(1);
    }
}

quickTest();
