import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import yaml from 'js-yaml';
import { URI } from 'langium';
import { NodeFileSystem } from 'langium/node';
import { createOmlServices } from '../../../oml-module.js';
import {
    isVocabulary,
    isRelationEntity,
    isUnreifiedRelation,
    isConcept,
    isAspect,
    Vocabulary,
    RelationEntity,
    UnreifiedRelation,
    Concept,
    Aspect,
    isPropertyRestrictionAxiom,
} from '../../../generated/ast.js';
import { resolveWorkspacePath } from '../common.js';
import {
    MethodologyPlaybook,
    RelationRule,
    RelationEntityRule,
    ConceptRule,
    ContainmentRule,
    AllocationRule,
} from './playbook-types.js';

export const extractMethodologyRulesTool = {
    name: 'extract_methodology_rules' as const,
    description: `CRITICAL: Generate a methodology playbook YAML file from vocabulary files.

⚠️ DO NOT CALL THIS TOOL WITHOUT ALL PARAMETERS ⚠️

MANDATORY PARAMETERS (ALWAYS provide all three):
1. vocabularyFiles: ARRAY of absolute file paths to .oml vocabulary files
   Example: ["c:/Users/sokhn/OneDrive/Documents/GitHub/sierra-method/src/oml/fireforce6.github.io/sierra/base.oml", ...]
   
2. methodologyName: STRING name like "Sierra"
   Example: "Sierra"
   
3. preferences: STRING either "passive" or "active"
   Example: "passive"

YOU MUST PROVIDE ALL THREE PARAMETERS. The tool will not work without them.

EXACT FORMAT REQUIRED:
Call with: {vocabularyFiles: ["path1", "path2", ...], methodologyName: "Name", preferences: "passive"}

OPTIONAL PARAMETERS:
- outputPath: STRING where to save the playbook (default: methodology_playbook.yaml in vocabulary directory)

GENERATES:
- A methodology_playbook.yaml file in the vocabulary directory
- Ready for use with enforce_methodology_rules tool`,
    paramsSchema: {
        vocabularyFiles: z.array(z.string()).describe('MUST PROVIDE: Array of absolute file paths to .oml vocabulary files - DO NOT OMIT'),
        methodologyName: z.string().describe('MUST PROVIDE: Methodology name like "Sierra" - DO NOT OMIT'),
        preferences: z.string().describe('MUST PROVIDE: Either "passive" or "active" for relation direction - DO NOT OMIT'),
        outputPath: z.string().optional().describe('Optional: Path to save YAML playbook file'),
    },
};

interface ExtractedRelation {
    name: string;
    forwardName: string;
    reverseName?: string;
    fromConcept: string;
    toConcept: string;
    isReified: boolean;
    sourceFile: string;
    vocabularyPrefix: string;
    description?: string;
}

interface ExtractedConcept {
    name: string;
    qualifiedName: string;
    superTypes: string[];
    restrictions: {
        property: string;
        kind: 'all' | 'some' | 'min' | 'max' | 'exactly';
        target?: string;
        cardinality?: number;
    }[];
    sourceFile: string;
}

/**
 * Auto-discover vocabulary bundle in workspace.
 * Looks for: bundle.oml, *-bundle.oml, or common locations like vocabularies/bundle.oml
 * Helper functions below (parseVocabulary, buildPlaybook, etc.)
 */

/**
 * Parse a vocabulary file and extract relations and concepts.
 */
async function parseVocabulary(filePath: string): Promise<{
    relations: ExtractedRelation[];
    concepts: ExtractedConcept[];
    vocabularyPrefix: string;
    vocabularyNamespace: string;
}> {
    const services = createOmlServices(NodeFileSystem).Oml;
    const resolvedPath = resolveWorkspacePath(filePath);
    
    if (!fs.existsSync(resolvedPath)) {
        throw new Error(`Vocabulary file not found: ${resolvedPath}`);
    }
    
    const content = fs.readFileSync(resolvedPath, 'utf-8');
    const uri = URI.file(resolvedPath);
    const document = services.shared.workspace.LangiumDocumentFactory.fromString(content, uri);
    
    await services.shared.workspace.DocumentBuilder.build([document], { validation: false });
    
    const root = document.parseResult.value;
    if (!isVocabulary(root)) {
        throw new Error(`File is not a vocabulary: ${filePath}`);
    }
    
    const vocabulary = root as Vocabulary;
    const vocabularyPrefix = vocabulary.prefix || '';
    const vocabularyNamespace = vocabulary.namespace || '';
    
    const relations: ExtractedRelation[] = [];
    const concepts: ExtractedConcept[] = [];
    
    // Process all members
    for (const member of vocabulary.ownedStatements || []) {
        // Extract relation entities (reified relations)
        if (isRelationEntity(member)) {
            const relEntity = member as RelationEntity;
            const fromTypes = relEntity.sources?.map(s => {
                const ref = s.ref;
                return ref ? ref.name || 'Unknown' : 'Unknown';
            }) || [];
            const toTypes = relEntity.targets?.map(t => {
                const ref = t.ref;
                return ref ? ref.name || 'Unknown' : 'Unknown';
            }) || [];
            
            relations.push({
                name: relEntity.name || 'Unknown',
                forwardName: relEntity.forwardRelation?.name || relEntity.name || 'Unknown',
                reverseName: relEntity.reverseRelation?.name,
                fromConcept: fromTypes.join(', ') || 'Unknown',
                toConcept: toTypes.join(', ') || 'Unknown',
                isReified: true,
                sourceFile: filePath,
                vocabularyPrefix,
            });
        }
        
        // Extract unreified relations
        if (isUnreifiedRelation(member)) {
            const unrel = member as UnreifiedRelation;
            const fromTypes = unrel.sources?.map(s => {
                const ref = s.ref;
                return ref ? ref.name || 'Unknown' : 'Unknown';
            }) || [];
            const toTypes = unrel.targets?.map(t => {
                const ref = t.ref;
                return ref ? ref.name || 'Unknown' : 'Unknown';
            }) || [];
            
            relations.push({
                name: unrel.name || 'Unknown',
                forwardName: unrel.name || 'Unknown',
                reverseName: unrel.reverseRelation?.name,
                fromConcept: fromTypes.join(', ') || 'Unknown',
                toConcept: toTypes.join(', ') || 'Unknown',
                isReified: false,
                sourceFile: filePath,
                vocabularyPrefix,
            });
        }
        
        // Extract concepts
        if (isConcept(member)) {
            const concept = member as Concept;
            const superTypes = concept.ownedSpecializations?.map(s => {
                const ref = s.superTerm?.ref;
                return ref ? ref.name || 'Unknown' : 'Unknown';
            }) || [];
            
            const restrictions: ExtractedConcept['restrictions'] = [];
            
            // Process restriction axioms from ownedEquivalences (which contain KeyAxioms and restrictions)
            for (const equiv of concept.ownedEquivalences || []) {
                // KeyAxioms and restrictions are in ownedPropertyRestrictions
                for (const restriction of equiv.ownedPropertyRestrictions || []) {
                    if (isPropertyRestrictionAxiom(restriction)) {
                        const propRestriction = restriction as any;
                        const kind = propRestriction.kind || 'all';
                        const property = propRestriction.property?.ref?.name || 'unknown';
                        restrictions.push({
                            property,
                            kind,
                            target: propRestriction.range?.ref?.name,
                            cardinality: propRestriction.cardinality,
                        });
                    }
                }
            }
            
            concepts.push({
                name: concept.name || 'Unknown',
                qualifiedName: `${vocabularyPrefix}:${concept.name}`,
                superTypes,
                restrictions,
                sourceFile: filePath,
            });
        }
        
        // Extract aspects
        if (isAspect(member)) {
            const aspect = member as Aspect;
            const superTypes = aspect.ownedSpecializations?.map(s => {
                const ref = s.superTerm?.ref;
                return ref ? ref.name || 'Unknown' : 'Unknown';
            }) || [];
            
            concepts.push({
                name: aspect.name || 'Unknown',
                qualifiedName: `${vocabularyPrefix}:${aspect.name}`,
                superTypes,
                restrictions: [],
                sourceFile: filePath,
            });
        }
    }
    
    return { relations, concepts, vocabularyPrefix, vocabularyNamespace };
}

/**
 * Build the playbook from extracted data and decisions.
 */
function buildPlaybook(
    allRelations: ExtractedRelation[],
    allConcepts: ExtractedConcept[],
    decisions: Map<string, { chosenOwner: string; rationale?: string }>,
    methodologyName: string,
    sourceFiles: string[]
): MethodologyPlaybook {
    const relationRules: RelationRule[] = [];
    const relationEntityRules: RelationEntityRule[] = [];
    const containmentRules: ContainmentRule[] = [];
    const allocationRules: AllocationRule[] = [];
    const conceptRules: ConceptRule[] = [];
    
    // Process relations
    for (const rel of allRelations) {
        const decision = decisions.get(rel.name) || decisions.get(`${rel.vocabularyPrefix}:${rel.name}`);
        const chosenOwner = decision?.chosenOwner || 'target'; // Default: target owns it
        const preferredDirection = chosenOwner === 'source' ? 'forward' : 'reverse';
        const owningConcept = chosenOwner === 'source' ? rel.fromConcept : rel.toConcept;
        
        if (rel.isReified) {
            // Relation entity rule
            relationEntityRules.push({
                relationEntity: `${rel.vocabularyPrefix}:${rel.name}`,
                forwardRelation: rel.forwardName,
                reverseRelation: rel.reverseName || '',
                fromConcept: rel.fromConcept,
                toConcept: rel.toConcept,
                preferredDirection,
                rationale: decision?.rationale || `Auto-extracted from ${rel.sourceFile}`,
                sourceFile: rel.sourceFile,
            });
        } else if (rel.reverseName) {
            // Unreified bidirectional relation
            relationRules.push({
                forwardRelation: `${rel.vocabularyPrefix}:${rel.forwardName}`,
                reverseRelation: `${rel.vocabularyPrefix}:${rel.reverseName}`,
                owningConcept: `${rel.vocabularyPrefix}:${owningConcept}`,
                preferredDirection,
                rationale: decision?.rationale || `Auto-extracted from ${rel.sourceFile}`,
                sourceFile: rel.sourceFile,
            });
            
            // Check for allocation patterns
            if (rel.forwardName.includes('Allocated') || rel.reverseName?.includes('Allocated') ||
                rel.forwardName.includes('allocates') || rel.reverseName?.includes('allocates')) {
                allocationRules.push({
                    subject: rel.fromConcept,
                    target: rel.toConcept,
                    relation: `${rel.vocabularyPrefix}:${rel.forwardName}`,
                    reverseRelation: `${rel.vocabularyPrefix}:${rel.reverseName}`,
                    owningConcept: `${rel.vocabularyPrefix}:${owningConcept}`,
                    preferredDirection,
                    rationale: decision?.rationale || 'Allocation pattern detected',
                });
            }
        }
    }
    
    // Process concepts for containment rules
    for (const concept of allConcepts) {
        // Check for Container/Contained patterns
        if (concept.superTypes.includes('Container')) {
            const containedTypes = concept.restrictions
                .filter(r => r.property === 'contains' && r.target)
                .map(r => r.target!);
            
            if (containedTypes.length > 0) {
                containmentRules.push({
                    container: concept.qualifiedName,
                    contained: containedTypes,
                    relation: 'base:contains',
                    cardinality: concept.restrictions
                        .filter(r => r.property === 'contains' && r.cardinality)
                        .reduce((acc, r) => ({
                            ...acc,
                            [r.kind]: r.cardinality,
                        }), {}),
                    sourceFile: concept.sourceFile,
                });
            }
        }
        
        // Build concept rules
        const requiredProps = concept.restrictions
            .filter(r => r.kind === 'exactly' || r.kind === 'min')
            .map(r => r.property);
        
        if (requiredProps.length > 0 || concept.superTypes.length > 0) {
            conceptRules.push({
                concept: concept.qualifiedName,
                requiredProperties: requiredProps.length > 0 ? requiredProps : undefined,
                notes: `Extends: ${concept.superTypes.join(', ') || 'none'}`,
            });
        }
    }
    
    return {
        metadata: {
            methodology: methodologyName,
            version: '1.0.0',
            generatedAt: new Date().toISOString(),
            sourceVocabularies: sourceFiles,
        },
        relationRules,
        relationEntityRules,
        conceptRules,
        containmentRules,
        allocationRules,
    };
}

export const extractMethodologyRulesHandler = async (params: {
    vocabularyFiles: string[];
    methodologyName: string;
    preferences: string;
    outputPath?: string;
}): Promise<{ content: { type: 'text'; text: string }[]; isError?: boolean }> => {
    try {
        const { vocabularyFiles, methodologyName, preferences } = params;
        
        console.error(`[extract_methodology_rules] Handler called with:`, { 
            vocabularyCount: vocabularyFiles?.length, 
            methodologyName, 
            preferences 
        });
        
        if (!vocabularyFiles || vocabularyFiles.length === 0) {
            const msg = `**vocabularyFiles is required.**\n\nProvide an array of absolute paths to vocabulary .oml files.`;
            console.error(`[extract_methodology_rules] ERROR: ${msg}`);
            return {
                content: [{ type: 'text', text: msg }],
                isError: true,
            };
        }
        
        if (!methodologyName) {
            const msg = `**methodologyName is required.**\n\nProvide a name for the methodology (e.g., "Sierra").`;
            console.error(`[extract_methodology_rules] ERROR: ${msg}`);
            return {
                content: [{ type: 'text', text: msg }],
                isError: true,
            };
        }
        
        if (!preferences) {
            const msg = `**preferences is required.**\n\nSpecify: "passive" (reverse voice) or "active" (forward voice).`;
            console.error(`[extract_methodology_rules] ERROR: ${msg}`);
            return {
                content: [{ type: 'text', text: msg }],
                isError: true,
            };
        }
        
        // Resolve all vocabulary paths
        const vocabularyPaths: string[] = [];
        const missingFiles: string[] = [];
        
        console.error(`[extract_methodology_rules] Resolving ${vocabularyFiles.length} paths...`);
        for (const vocabFile of vocabularyFiles) {
            try {
                // For absolute paths, use them directly without resolveWorkspacePath
                // This allows working with files outside the current workspace
                let resolved: string;
                if (path.isAbsolute(vocabFile)) {
                    resolved = vocabFile;
                } else {
                    resolved = resolveWorkspacePath(vocabFile);
                }
                console.error(`[extract_methodology_rules] Path: ${vocabFile} -> ${resolved}`);
                if (fs.existsSync(resolved)) {
                    vocabularyPaths.push(resolved);
                    console.error(`[extract_methodology_rules] ✓ File exists: ${resolved}`);
                } else {
                    console.error(`[extract_methodology_rules] ✗ File not found: ${resolved}`);
                    missingFiles.push(vocabFile);
                }
            } catch (err) {
                console.error(`[extract_methodology_rules] Error resolving ${vocabFile}: ${err}`);
                missingFiles.push(vocabFile);
            }
        }
        
        if (vocabularyPaths.length === 0) {
            const msg = `**No vocabulary files found.**\n\nRequested ${vocabularyFiles.length} files:\n${missingFiles.map(f => `- ${f}`).join('\n')}`;
            console.error(`[extract_methodology_rules] ERROR: ${msg}`);
            return {
                content: [{ type: 'text', text: msg }],
                isError: true,
            };
        }
        
        console.error(`[extract_methodology_rules] Found ${vocabularyPaths.length}/${vocabularyFiles.length} valid files`);
        
        if (missingFiles.length > 0) {
            console.error(`[extract_methodology_rules] Warning: ${missingFiles.length} files not found`);
        }
        
        // Determine output path - default to same directory as first vocabulary
        const firstVocabDir = path.dirname(vocabularyPaths[0]);
        const outputPath = params.outputPath 
            ? (path.isAbsolute(params.outputPath) ? params.outputPath : path.join(firstVocabDir, params.outputPath))
            : path.join(firstVocabDir, 'methodology_playbook.yaml');
        
        console.error(`[extract_methodology_rules] Processing ${vocabularyPaths.length} vocabulary files`);
        console.error(`[extract_methodology_rules] Output will be saved to: ${outputPath}`);
        
        // Parse all vocabularies to extract relations and concepts
        const allRelations: ExtractedRelation[] = [];
        const allConcepts: ExtractedConcept[] = [];
        const parsedFiles: string[] = [];
        const errors: string[] = [];
        
        for (const vocabPath of vocabularyPaths) {
            try {
                console.error(`[extract_methodology_rules] Parsing: ${vocabPath}`);
                const { relations, concepts } = await parseVocabulary(vocabPath);
                allRelations.push(...relations);
                allConcepts.push(...concepts);
                parsedFiles.push(vocabPath);
                console.error(`[extract_methodology_rules] Found ${relations.length} relations, ${concepts.length} concepts`);
            } catch (err) {
                const errorMsg = `Could not parse ${path.basename(vocabPath)}: ${err}`;
                console.error(`[extract_methodology_rules] ${errorMsg}`);
                errors.push(errorMsg);
            }
        }
        
        if (parsedFiles.length === 0) {
            const msg = `**Failed to parse any vocabulary files.** Tried ${vocabularyPaths.length} files.\n\nErrors:\n${errors.map(e => `- ${e}`).join('\n')}`;
            console.error(`[extract_methodology_rules] ERROR: ${msg}`);
            return {
                content: [{ type: 'text', text: msg }],
                isError: true,
            };
        }
        
        console.error(`[extract_methodology_rules] Parsed ${parsedFiles.length}/${vocabularyPaths.length} files successfully`);
        console.error(`[extract_methodology_rules] Found ${allRelations.length} relations, ${allConcepts.length} concepts`);
        
        // Validate preferences parameter
        if (!preferences || (preferences.toLowerCase() !== 'passive' && preferences.toLowerCase() !== 'active')) {
            const msg = `**Invalid preferences: "${preferences}"**\n\nMust specify: "passive" or "active"`;
            console.error(`[extract_methodology_rules] ERROR: ${msg}`);
            return {
                content: [{ type: 'text', text: msg }],
                isError: true,
            };
        }
        
        console.error(`[extract_methodology_rules] Using preference: ${preferences}`);
        
        // Determine the preferred direction from preferences parameter
        const preferredDirection = preferences?.toLowerCase() === 'active' ? 'source' : 'target'; // default: passive/target
        
        // Build decisions map with choices based on preferences
        const decisionsMap = new Map<string, { chosenOwner: string; rationale?: string }>();
        for (const rel of allRelations) {
            if (rel.reverseName) {
                let chosenOwner = preferredDirection;
                const voiceType = preferences.toLowerCase() === 'active' ? 'active/forward' : 'passive/reverse';
                const rationale = `Preference: ${voiceType} voice`;
                
                decisionsMap.set(rel.name, { chosenOwner, rationale });
            }
        }
        
        // Build the playbook
        const playbook = buildPlaybook(allRelations, allConcepts, decisionsMap, methodologyName, parsedFiles);
        
        // Write YAML output
        const yamlContent = yaml.dump(playbook, { indent: 2, lineWidth: -1 });
        
        // Ensure directory exists
        const outputDir = path.dirname(outputPath);
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
        
        fs.writeFileSync(outputPath, yamlContent, 'utf-8');
        console.error(`[extract_methodology_rules] Playbook written to: ${outputPath}`);
        
        const summary = [
            `✅ Methodology playbook extracted successfully!`,
            ``,
            `**Output:** \`${outputPath}\``,
            `**Methodology:** ${methodologyName}`,
            ``,
            `## Summary`,
            `- Vocabularies parsed: ${parsedFiles.length}/${vocabularyPaths.length}`,
            `- Relations: ${allRelations.length} (${allRelations.filter(r => r.reverseName).length} bidirectional)`,
            `- Concepts/Aspects: ${allConcepts.length}`,
            `- Relation rules: ${playbook.relationRules.length}`,
            `- Relation entity rules: ${playbook.relationEntityRules.length}`,
            `- Concept rules: ${playbook.conceptRules.length}`,
            `- Containment rules: ${playbook.containmentRules.length}`,
            ``,
            `## Vocabularies Analyzed`,
            ...parsedFiles.map(f => `- \`${path.basename(f)}\``),
            ``,
            `## Next Steps`,
            `To validate descriptions against this playbook:`,
            `1. Call \`enforce_methodology_rules\` with:`,
            `   - \`methodologyName: "${methodologyName}"\``,
            `   - \`descriptionPath\` or \`descriptionCode\``,
            `2. Tool will auto-discover playbook by walking up directory tree`,
            ``,
            `**Tip:** Keep playbook in same directory as vocabularies for auto-discovery.`,
        ];
        
        if (errors.length > 0) {
            summary.push(``);
            summary.push(`## Warnings`);
            summary.push(...errors.map(e => `- ${e}`));
        }
        
        if (playbook.relationRules.length > 0) {
            summary.push(``);
            summary.push(`## Relation Direction Conventions`);
            for (const rule of playbook.relationRules.slice(0, 10)) {
                const preferred = rule.preferredDirection === 'forward' ? rule.forwardRelation : rule.reverseRelation;
                summary.push(`- **${rule.forwardRelation}**: prefer \`${preferred}\``);
            }
            if (playbook.relationRules.length > 10) {
                summary.push(`- ... and ${playbook.relationRules.length - 10} more (see YAML file)`);
            }
        }
        
        return {
            content: [{ type: 'text', text: summary.join('\n') }],
        };
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error ? error.stack : '';
        console.error(`[extract_methodology_rules] CAUGHT EXCEPTION: ${errorMsg}`);
        console.error(stack);
        return {
            content: [{ 
                type: 'text', 
                text: `**Error extracting methodology rules:**\n\n${errorMsg}\n\n(Check server logs for full stack trace)` 
            }],
            isError: true,
        };
    }
};
