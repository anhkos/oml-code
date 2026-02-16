/**
 * Tool: route_instance
 * 
 * Helps LLMs (like GitHub Copilot) determine which description file
 * should contain a new instance based on its type.
 * 
 * IMPORTANT: Returns the ACTUAL file path, not just the filename.
 * Searches the workspace to find existing description files.
 */

import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import type { MethodologyPlaybook, DescriptionSchema } from './playbook-types.js';
import { resolvePlaybookPath, loadPlaybook as loadPlaybookFromCore } from './core/index.js';

export const routeInstanceTool = {
    name: 'route_instance' as const,
    description: `Determine the best EXISTING DESCRIPTION file for placing a new instance based on its type.

⚠️ IMPORTANT: Instances can ONLY be placed in DESCRIPTION files, NOT in vocabulary files.
This tool automatically filters out vocabulary files and only suggests description files.

USE THIS TOOL when the user asks:
- "Where should I put this Requirement instance?"
- "Which file should contain my Stakeholder?"
- "Create a new Component - but where?"

DO NOT USE this tool when:
- The user already provided the target description file path
- The user provided a complete OML description snippet and expects direct creation

RETURNS: The ABSOLUTE PATH to an existing description file.
Searches the workspace, reads file headers to verify they are descriptions (not vocabularies).

AUTO-DETECTS:
- The methodology playbook in the workspace
- Available DESCRIPTION files only (excludes vocabularies)
- The correct path even when there are multiple directories

Output includes:
- Absolute path to the recommended description file
- Verification that the file exists AND is a description
- Alternative description files if applicable`,
    
    paramsSchema: {
        instanceType: z.string().describe('The type of instance to place (e.g., "requirement:Requirement", "Stakeholder")'),
        playbookPath: z.string().optional().describe('Path to the methodology playbook (auto-detects if not provided)'),
        workspacePath: z.string().optional().describe('Workspace path for file search (auto-detects from CWD)'),
    },
};

/**
 * Routing result for a single file.
 */
interface FileRouting {
    file: string;           // Filename from playbook
    absolutePath: string;   // Resolved absolute path
    exists: boolean;        // Whether file actually exists
    priority: number;
    confidence: number;     // 0-100
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
 * Check if an OML file is a description (not a vocabulary).
 * Reads the first few lines to check for the 'description' keyword.
 */
function isDescriptionFile(filePath: string): boolean {
    try {
        // Read just enough to find the ontology type declaration
        const content = fs.readFileSync(filePath, 'utf-8').slice(0, 2000);
        
        // Description files start with 'description' keyword (after optional annotations)
        // Vocabulary files start with 'vocabulary' keyword
        // Skip comments and annotations to find the first keyword
        const lines = content.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            // Skip comments, annotations, empty lines
            if (trimmed.startsWith('//') || trimmed.startsWith('@') || trimmed === '') {
                continue;
            }
            // Check for ontology type keywords
            if (trimmed.startsWith('description ')) {
                return true;
            }
            if (trimmed.startsWith('vocabulary ') || 
                trimmed.startsWith('vocabulary_bundle ') ||
                trimmed.startsWith('description_bundle ')) {
                return false;
            }
            // If we hit another keyword first, it's not a simple description
            break;
        }
        return false;
    } catch {
        return false;
    }
}

/**
 * Search for OML DESCRIPTION files only (excludes vocabularies).
 */
function findDescriptionFiles(dirPath: string, maxDepth: number = 10, currentDepth: number = 0): Map<string, string> {
    const results = new Map<string, string>(); // filename -> absolute path
    
    if (currentDepth > maxDepth) return results;
    
    try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        
        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            
            if (entry.isFile() && entry.name.endsWith('.oml')) {
                // Only include description files
                if (isDescriptionFile(fullPath)) {
                    const existing = results.get(entry.name);
                    if (!existing) {
                        results.set(entry.name, fullPath);
                    }
                }
            } else if (entry.isDirectory() && 
                       !entry.name.startsWith('.') && 
                       entry.name !== 'node_modules' && 
                       entry.name !== 'build' &&
                       !entry.name.includes('vocabulary')) {
                // Skip vocabulary directories entirely for efficiency
                const subResults = findDescriptionFiles(fullPath, maxDepth, currentDepth + 1);
                for (const [name, subPath] of subResults) {
                    const existing = results.get(name);
                    if (!existing) {
                        results.set(name, subPath);
                    }
                }
            }
        }
    } catch {
        // Ignore directories we can't read
    }
    
    return results;
}

/**
 * Find the actual path to a description file by searching the workspace.
 * Only returns paths to DESCRIPTION files, not vocabularies.
 */
function resolveDescriptionPath(
    fileName: string, 
    workspacePath: string,
    playbookDir?: string
): string | null {
    // First, check if the filename already contains a path
    if (path.isAbsolute(fileName) && fs.existsSync(fileName)) {
        // Verify it's actually a description file
        if (isDescriptionFile(fileName)) {
            return fileName;
        }
        return null;
    }
    
    // Check relative to playbook directory first (most likely location)
    if (playbookDir) {
        const nearPlaybook = path.join(playbookDir, '..', fileName);
        if (fs.existsSync(nearPlaybook) && isDescriptionFile(nearPlaybook)) {
            return path.resolve(nearPlaybook);
        }
        
        // Check sibling directories of playbook
        const playbookParent = path.dirname(playbookDir);
        try {
            const siblings = fs.readdirSync(playbookParent, { withFileTypes: true });
            for (const sibling of siblings) {
                if (sibling.isDirectory()) {
                    const inSibling = path.join(playbookParent, sibling.name, fileName);
                    if (fs.existsSync(inSibling) && isDescriptionFile(inSibling)) {
                        return path.resolve(inSibling);
                    }
                }
            }
        } catch {
            // Ignore read errors
        }
    }
    
    // Search the entire workspace for description files only
    const descriptionFiles = findDescriptionFiles(workspacePath);
    const baseName = path.basename(fileName);
    
    // Try exact match first
    if (descriptionFiles.has(baseName)) {
        return descriptionFiles.get(baseName)!;
    }
    
    // Try partial match (file might be referenced with different extension or path)
    const nameWithoutExt = baseName.replace('.oml', '');
    for (const [foundName, foundPath] of descriptionFiles) {
        if (foundName.includes(nameWithoutExt) || nameWithoutExt.includes(foundName.replace('.oml', ''))) {
            return foundPath;
        }
    }
    
    return null;
}

/**
 * Calculate routing for a specific type.
 */
function calculateRouting(
    instanceType: string,
    descriptions: Record<string, DescriptionSchema>,
    workspacePath: string,
    playbookDir?: string
): RoutingRecommendation {
    const routings: FileRouting[] = [];
    
    for (const [fileName, schema] of Object.entries(descriptions)) {
        const isAllowed = schema.allowedTypes.includes(instanceType);
        
        // Resolve the actual file path
        const absolutePath = resolveDescriptionPath(fileName, workspacePath, playbookDir);
        const exists = absolutePath !== null && fs.existsSync(absolutePath);
        
        // Check routing priorities
        const routingEntry = schema.routing?.find(r => r.concept === instanceType);
        const priority = routingEntry?.priority ?? 999;
        
        // Calculate confidence
        let confidence = 0;
        let reason = '';
        
        if (!exists) {
            confidence = 0;
            reason = 'File does not exist in workspace';
        } else if (isAllowed) {
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
            const patternMatch = schema.allowedTypes?.some(allowed => {
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
            absolutePath: absolutePath || `(not found: ${fileName})`,
            exists,
            priority,
            confidence,
            reason,
            isAllowed: (isAllowed || confidence > 0) && exists,
        });
    }
    
    // Sort by confidence (descending), then priority (ascending)
    // Only consider files that exist
    routings.sort((a, b) => {
        // Existing files first
        if (a.exists !== b.exists) return a.exists ? -1 : 1;
        if (a.confidence !== b.confidence) return b.confidence - a.confidence;
        return a.priority - b.priority;
    });
    
    const recommended = routings.find(r => r.confidence > 0 && r.exists) || null;
    const alternatives = routings.filter(r => r !== recommended && r.confidence > 0 && r.exists);
    const notFound = routings.filter(r => !r.exists && r.confidence > 0);
    
    let explanation: string;
    
    if (recommended) {
        if (recommended.confidence >= 90) {
            explanation = `✅ Strong match: "${instanceType}" should go in "${recommended.absolutePath}"`;
        } else if (recommended.confidence >= 50) {
            explanation = `👍 Good match: "${instanceType}" is allowed in "${recommended.absolutePath}"`;
        } else {
            explanation = `⚠️ Weak match: "${instanceType}" may fit in "${recommended.absolutePath}"`;
        }
        
        if (alternatives.length > 0) {
            explanation += `\n\nAlternatives: ${alternatives.map(a => path.basename(a.absolutePath)).join(', ')}`;
        }
    } else if (notFound.length > 0) {
        explanation = `⚠️ Playbook suggests "${notFound[0].file}" but file was not found in workspace.\n\n` +
            `Searched for: ${notFound.map(f => f.file).join(', ')}\n\n` +
            `You may need to create this description file first, or update the playbook with correct file paths.`;
    } else {
        explanation = `❌ No matching description found for type "${instanceType}".\n\n` +
            `Consider:\n` +
            `1. Creating a new description file\n` +
            `2. Updating allowedTypes in the playbook to include this type`;
    }
    
    return { recommended, alternatives, explanation };
}

/**
 * Infer routing when no playbook descriptions exist.
 * Searches workspace for actual description files only (not vocabularies).
 */
function inferRouting(instanceType: string, workspacePath: string): RoutingRecommendation {
    // Find only DESCRIPTION files in workspace (excludes vocabularies)
    const descriptionFiles = findDescriptionFiles(workspacePath);
    
    // Best-effort inference based on type naming conventions
    const typeParts = instanceType.split(':');
    const prefix = typeParts[0] || '';
    const name = typeParts[1] || typeParts[0];
    
    // Common patterns to search for
    const searchPatterns: string[] = [];
    
    if (prefix.includes('requirement') || name.toLowerCase().includes('requirement')) {
        searchPatterns.push('stakeholders_requirements', 'requirements', 'stakeholder');
    }
    if (prefix.includes('stakeholder') || name.toLowerCase().includes('stakeholder')) {
        searchPatterns.push('stakeholders_requirements', 'stakeholders', 'stakeholder');
    }
    if (prefix.includes('component') || name.toLowerCase().includes('component')) {
        searchPatterns.push('system_components', 'components', 'component');
    }
    if (prefix.includes('interface') || name.toLowerCase().includes('interface')) {
        searchPatterns.push('interfaces', 'system_components');
    }
    if (prefix.includes('function') || name.toLowerCase().includes('function')) {
        searchPatterns.push('functions', 'functional_analysis');
    }
    if (prefix.includes('capability') || name.toLowerCase().includes('capability')) {
        searchPatterns.push('missions_capabilities', 'capabilities', 'capability');
    }
    if (prefix.includes('mission') || name.toLowerCase().includes('mission')) {
        searchPatterns.push('missions_capabilities', 'missions', 'mission');
    }
    if (prefix.includes('process') || name.toLowerCase().includes('process') || 
        prefix.includes('activity') || name.toLowerCase().includes('activity')) {
        searchPatterns.push('processes_activities', 'processes', 'activities');
    }
    if (prefix.includes('scenario') || name.toLowerCase().includes('scenario')) {
        searchPatterns.push('scenarios', 'scenario');
    }
    if (prefix.includes('state') || name.toLowerCase().includes('state')) {
        searchPatterns.push('state_machines', 'states', 'state');
    }
    
    // Default: use prefix
    if (searchPatterns.length === 0) {
        searchPatterns.push(prefix, `${prefix}_instances`);
    }
    
    // Find matching description files
    const matches: FileRouting[] = [];
    
    for (const [fileName, filePath] of descriptionFiles) {
        const fileNameLower = fileName.toLowerCase();
        
        for (let i = 0; i < searchPatterns.length; i++) {
            const pattern = searchPatterns[i].toLowerCase();
            if (fileNameLower.includes(pattern)) {
                matches.push({
                    file: fileName,
                    absolutePath: filePath,
                    exists: true,
                    priority: i + 1,
                    confidence: 70 - i * 10,
                    reason: `Matches pattern "${pattern}" from type "${instanceType}"`,
                    isAllowed: true,
                });
                break; // Only match once per file
            }
        }
    }
    
    // Sort by confidence
    matches.sort((a, b) => b.confidence - a.confidence);
    
    const recommended = matches[0] || null;
    const alternatives = matches.slice(1, 4);
    
    let explanation: string;
    if (recommended) {
        explanation = `No playbook found. Based on type "${instanceType}", suggesting "${recommended.absolutePath}"`;
        if (alternatives.length > 0) {
            explanation += `\n\nAlternatives: ${alternatives.map(a => a.absolutePath).join(', ')}`;
        }
    } else {
        explanation = `No playbook found and no matching description files for type "${instanceType}".\n\n` +
            `Found ${descriptionFiles.size} description files in workspace, but none match the expected patterns.\n` +
            `You may need to create a new description file.`;
    }
    
    return { recommended, alternatives, explanation };
}

export const routeInstanceHandler = async (params: {
    instanceType: string;
    playbookPath?: string;
    workspacePath?: string;
}): Promise<{ content: { type: 'text'; text: string }[]; isError?: boolean }> => {
    try {
        const { instanceType, playbookPath } = params;
        
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
        
        // Try to find the playbook using shared helper or direct path
        let playbook: MethodologyPlaybook | null = null;
        let playbookDir: string | undefined;
        
        if (playbookPath && fs.existsSync(playbookPath)) {
            playbook = loadPlaybookFromCore(playbookPath);
            playbookDir = path.dirname(playbookPath);
        } else {
            const resolvedPath = resolvePlaybookPath({ workspacePath });
            if (resolvedPath) {
                playbook = loadPlaybookFromCore(resolvedPath);
                playbookDir = path.dirname(resolvedPath);
            }
        }
        
        let recommendation: RoutingRecommendation;
        
        if (playbook?.descriptions && Object.keys(playbook.descriptions).length > 0) {
            recommendation = calculateRouting(instanceType, playbook.descriptions, workspacePath, playbookDir);
        } else {
            recommendation = inferRouting(instanceType, workspacePath);
        }
        
        // Format output - PRIORITIZE THE ABSOLUTE PATH
        const lines: string[] = [];
        
        lines.push(`# Instance Routing: ${instanceType}`);
        lines.push(``);
        
        if (recommendation.recommended) {
            const rec = recommendation.recommended;
            const confidenceEmoji = rec.confidence >= 90 ? '✅' : rec.confidence >= 50 ? '👍' : '⚠️';
            
            lines.push(`## Recommended Description File`);
            lines.push(``);
            lines.push(`${confidenceEmoji} **ABSOLUTE PATH:** \`${rec.absolutePath}\``);
            lines.push(``);
            lines.push(`| Property | Value |`);
            lines.push(`|----------|-------|`);
            lines.push(`| File | ${rec.file} |`);
            lines.push(`| Absolute Path | ${rec.absolutePath} |`);
            lines.push(`| Exists | ${rec.exists ? '✅ Yes' : '❌ No'} |`);
            lines.push(`| Confidence | ${rec.confidence}% |`);
            lines.push(`| Reason | ${rec.reason} |`);
            lines.push(``);
            
            if (recommendation.alternatives.length > 0) {
                lines.push(`## Alternatives`);
                for (const alt of recommendation.alternatives) {
                    lines.push(`- \`${alt.absolutePath}\` (${alt.confidence}%)`);
                }
                lines.push(``);
            }
        } else {
            lines.push(`## ⚠️ No Existing Description File Found`);
            lines.push(``);
        }
        
        lines.push(`## Summary`);
        lines.push(recommendation.explanation);
        
        // Add structured data for programmatic use - INCLUDE ABSOLUTE PATH
        lines.push(``);
        lines.push(`## Routing Data (JSON)`);
        lines.push(``);
        lines.push(`Use this data to determine where to create the instance:`);
        lines.push(``);
        lines.push('```json');
        lines.push(JSON.stringify({
            instanceType,
            recommended: recommendation.recommended ? {
                file: recommendation.recommended.file,
                absolutePath: recommendation.recommended.absolutePath,
                exists: recommendation.recommended.exists,
                confidence: recommendation.recommended.confidence,
            } : null,
            alternatives: recommendation.alternatives.map(a => ({
                file: a.file,
                absolutePath: a.absolutePath,
                exists: a.exists,
                confidence: a.confidence,
            })),
        }, null, 2));
        lines.push('```');
        
        // CRITICAL instruction for AI models
        if (recommendation.recommended?.exists) {
            lines.push(``);
            lines.push(`---`);
            lines.push(`**IMPORTANT:** Use the \`absolutePath\` value above as the \`ontology\` parameter when calling \`create_concept_instance\`.`);
        } else if (!recommendation.recommended) {
            lines.push(``);
            lines.push(`---`);
            lines.push(`**IMPORTANT:** No existing file found. You may need to create a new description file first using \`create_ontology\`.`);
        }
        
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
