/**
 * Tool: route_instance
 * 
 * Helps LLMs (like GitHub Copilot) determine which description file
 * should contain a new instance based on its type.
 */

import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import yaml from 'js-yaml';
import type { MethodologyPlaybook, DescriptionSchema } from './playbook-types.js';

export const routeInstanceTool = {
    name: 'route_instance' as const,
    description: `Determine the best description file for placing a new instance based on its type.

USE THIS TOOL when the user asks:
- "Where should I put this Requirement instance?"
- "Which file should contain my Stakeholder?"
- "Create a new Component - but where?"

The tool AUTO-DETECTS:
- The methodology playbook in the workspace
- Available description files from the playbook's descriptions section

Just provide the instance type, and optionally the workspace path. It will find the playbook automatically.

Returns:
- Primary recommendation with confidence score
- Alternative files if applicable  
- Reasoning for the recommendation`,
    
    paramsSchema: {
        instanceType: z.string().describe('The type of instance to place (e.g., "requirement:Requirement", "Stakeholder")'),
        playbookPath: z.string().optional().describe('Path to the methodology playbook (auto-detects if not provided)'),
        methodologyName: z.string().optional().describe('Methodology name to help find playbook (e.g., "Sierra")'),
        workspacePath: z.string().optional().describe('Workspace path for playbook detection (auto-detects from CWD)'),
    },
};

/**
 * Routing result for a single file.
 */
interface FileRouting {
    file: string;
    priority: number;
    confidence: number;  // 0-100
    reason: string;
    isAllowed: boolean;
}

/**
 * Overall routing recommendation.
 */
interface RoutingRecommendation {
    recommended: FileRouting | null;
    alternatives: FileRouting[];
    explanation: string;
}

/**
 * Load playbook from path or auto-detect.
 */
function loadPlaybook(
    playbookPath?: string, 
    methodologyName?: string, 
    workspacePath?: string
): MethodologyPlaybook | null {
    if (playbookPath && fs.existsSync(playbookPath)) {
        const content = fs.readFileSync(playbookPath, 'utf-8');
        return yaml.load(content) as MethodologyPlaybook;
    }
    
    // Auto-detect playbook
    const searchPaths: string[] = [];
    
    if (workspacePath) {
        searchPaths.push(workspacePath);
        searchPaths.push(path.join(workspacePath, 'src'));
        searchPaths.push(path.join(workspacePath, 'build'));
    }
    
    const patterns = methodologyName 
        ? [`${methodologyName.toLowerCase()}_playbook.yaml`, 'methodology_playbook.yaml', 'playbook.yaml']
        : ['methodology_playbook.yaml', 'playbook.yaml', '*_playbook.yaml'];
    
    for (const searchPath of searchPaths) {
        if (!fs.existsSync(searchPath)) continue;
        
        for (const pattern of patterns) {
            if (pattern.includes('*')) {
                // Glob pattern - search directory
                try {
                    const files = fs.readdirSync(searchPath);
                    for (const file of files) {
                        if (file.endsWith('_playbook.yaml')) {
                            const fullPath = path.join(searchPath, file);
                            const content = fs.readFileSync(fullPath, 'utf-8');
                            return yaml.load(content) as MethodologyPlaybook;
                        }
                    }
                } catch { /* ignore */ }
            } else {
                const fullPath = path.join(searchPath, pattern);
                if (fs.existsSync(fullPath)) {
                    const content = fs.readFileSync(fullPath, 'utf-8');
                    return yaml.load(content) as MethodologyPlaybook;
                }
            }
        }
    }
    
    return null;
}

/**
 * Calculate routing for a specific type.
 */
function calculateRouting(
    instanceType: string,
    descriptions: Record<string, DescriptionSchema>
): RoutingRecommendation {
    const routings: FileRouting[] = [];
    
    for (const [fileName, schema] of Object.entries(descriptions)) {
        const isAllowed = schema.allowedTypes.includes(instanceType);
        
        // Check routing priorities
        const routingEntry = schema.routing.find(r => r.concept === instanceType);
        const priority = routingEntry?.priority ?? 999;
        
        // Calculate confidence
        let confidence = 0;
        let reason = '';
        
        if (isAllowed) {
            if (routingEntry) {
                // Explicitly routed here
                confidence = 100 - (priority - 1) * 10;  // Priority 1 = 100%, 2 = 90%, etc.
                reason = `Explicitly routed with priority ${priority}`;
            } else {
                // Allowed but not explicitly routed
                confidence = 50;
                reason = 'Type is allowed but not explicitly routed';
            }
        } else {
            // Check if type matches a pattern in allowed types
            const patternMatch = schema.allowedTypes.some(allowed => {
                if (allowed.includes('*')) {
                    const regex = new RegExp('^' + allowed.replace(/\*/g, '.*') + '$');
                    return regex.test(instanceType);
                }
                return false;
            });
            
            if (patternMatch) {
                confidence = 30;
                reason = 'Type matches a pattern in allowedTypes';
            } else {
                confidence = 0;
                reason = 'Type not allowed in this description';
            }
        }
        
        routings.push({
            file: fileName,
            priority,
            confidence,
            reason,
            isAllowed: isAllowed || confidence > 0,
        });
    }
    
    // Sort by confidence (descending), then priority (ascending)
    routings.sort((a, b) => {
        if (a.confidence !== b.confidence) return b.confidence - a.confidence;
        return a.priority - b.priority;
    });
    
    const recommended = routings.find(r => r.confidence > 0) || null;
    const alternatives = routings.filter(r => r !== recommended && r.confidence > 0);
    
    let explanation: string;
    
    if (recommended) {
        if (recommended.confidence >= 90) {
            explanation = `Strong match: "${instanceType}" should go in "${recommended.file}" (${recommended.reason})`;
        } else if (recommended.confidence >= 50) {
            explanation = `Good match: "${instanceType}" is allowed in "${recommended.file}" (${recommended.reason})`;
        } else {
            explanation = `Weak match: "${instanceType}" may fit in "${recommended.file}" (${recommended.reason})`;
        }
        
        if (alternatives.length > 0) {
            explanation += `. Alternatives: ${alternatives.map(a => a.file).join(', ')}`;
        }
    } else {
        explanation = `No matching description found for type "${instanceType}". Consider creating a new description file or updating allowedTypes in the playbook.`;
    }
    
    return { recommended, alternatives, explanation };
}

/**
 * Infer routing when no playbook descriptions exist.
 */
function inferRouting(instanceType: string): RoutingRecommendation {
    // Best-effort inference based on type naming conventions
    const typeParts = instanceType.split(':');
    const prefix = typeParts[0] || '';
    const name = typeParts[1] || typeParts[0];
    
    // Common patterns
    const suggestions: string[] = [];
    
    if (prefix.includes('requirement') || name.toLowerCase().includes('requirement')) {
        suggestions.push('stakeholders_requirements.oml', 'requirements.oml');
    }
    if (prefix.includes('stakeholder') || name.toLowerCase().includes('stakeholder')) {
        suggestions.push('stakeholders_requirements.oml', 'stakeholders.oml');
    }
    if (prefix.includes('component') || name.toLowerCase().includes('component')) {
        suggestions.push('system_components.oml', 'components.oml');
    }
    if (prefix.includes('interface') || name.toLowerCase().includes('interface')) {
        suggestions.push('interfaces.oml', 'system_components.oml');
    }
    if (prefix.includes('function') || name.toLowerCase().includes('function')) {
        suggestions.push('functions.oml', 'functional_analysis.oml');
    }
    
    // Default suggestion based on prefix
    if (suggestions.length === 0) {
        suggestions.push(`${prefix}_instances.oml`, `${prefix}.oml`);
    }
    
    return {
        recommended: {
            file: suggestions[0],
            priority: 1,
            confidence: 40,
            reason: 'Inferred from type naming convention (no playbook descriptions defined)',
            isAllowed: true,
        },
        alternatives: suggestions.slice(1).map((file, i) => ({
            file,
            priority: i + 2,
            confidence: 30 - i * 5,
            reason: 'Alternative inference',
            isAllowed: true,
        })),
        explanation: `No playbook descriptions defined. Suggesting "${suggestions[0]}" based on type naming convention.`,
    };
}

export const routeInstanceHandler = async (params: {
    instanceType: string;
    playbookPath?: string;
    methodologyName?: string;
    workspacePath?: string;
}): Promise<{ content: { type: 'text'; text: string }[]; isError?: boolean }> => {
    try {
        const { instanceType, playbookPath, methodologyName } = params;
        
        // Auto-detect workspace from CWD if not provided
        const workspacePath = params.workspacePath || process.cwd();
        
        if (!instanceType) {
            return {
                content: [{
                    type: 'text',
                    text: '**Error:** instanceType is required.',
                }],
                isError: true,
            };
        }
        
        // Load playbook
        const playbook = loadPlaybook(playbookPath, methodologyName, workspacePath);
        
        let recommendation: RoutingRecommendation;
        
        if (playbook?.descriptions && Object.keys(playbook.descriptions).length > 0) {
            recommendation = calculateRouting(instanceType, playbook.descriptions);
        } else {
            recommendation = inferRouting(instanceType);
        }
        
        // Format output
        const lines: string[] = [];
        
        lines.push(`# Instance Routing: ${instanceType}`);
        lines.push(``);
        
        if (recommendation.recommended) {
            const rec = recommendation.recommended;
            const confidenceEmoji = rec.confidence >= 90 ? '✅' : rec.confidence >= 50 ? '👍' : '⚠️';
            
            lines.push(`## Recommended File`);
            lines.push(`${confidenceEmoji} **${rec.file}**`);
            lines.push(`- Confidence: ${rec.confidence}%`);
            lines.push(`- Priority: ${rec.priority}`);
            lines.push(`- Reason: ${rec.reason}`);
            lines.push(``);
            
            if (recommendation.alternatives.length > 0) {
                lines.push(`## Alternatives`);
                for (const alt of recommendation.alternatives) {
                    lines.push(`- **${alt.file}** (${alt.confidence}% confidence) - ${alt.reason}`);
                }
                lines.push(``);
            }
        } else {
            lines.push(`## ⚠️ No Match Found`);
            lines.push(``);
        }
        
        lines.push(`## Summary`);
        lines.push(recommendation.explanation);
        
        // Add structured data for programmatic use
        lines.push(``);
        lines.push(`## Routing Data (JSON)`);
        lines.push('```json');
        lines.push(JSON.stringify({
            instanceType,
            recommended: recommendation.recommended ? {
                file: recommendation.recommended.file,
                confidence: recommendation.recommended.confidence,
            } : null,
            alternatives: recommendation.alternatives.map(a => ({
                file: a.file,
                confidence: a.confidence,
            })),
        }, null, 2));
        lines.push('```');
        
        return {
            content: [{
                type: 'text',
                text: lines.join('\n'),
            }],
        };
        
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
            content: [{
                type: 'text',
                text: `**Error routing instance:**\n\n${errorMsg}`,
            }],
            isError: true,
        };
    }
};
