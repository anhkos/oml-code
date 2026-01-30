import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { URI } from 'langium';
import { NodeFileSystem } from 'langium/node';
import { createOmlServices } from '../../../oml-module.js';
import {
    isVocabulary,
    isRelationEntity,
    isUnreifiedRelation,
    Vocabulary,
    RelationEntity,
    UnreifiedRelation,
} from '../../../generated/ast.js';
import { resolveWorkspacePath } from '../common.js';

export const clarifyMethodologyPreferencesTool = {
    name: 'clarify_methodology_preferences' as const,
    description: `CRITICAL: Analyze vocabulary relations and clarify user preferences for methodology playbook.

⚠️ DO NOT CALL THIS TOOL WITHOUT PARAMETERS ⚠️

MANDATORY PARAMETERS (ALWAYS provide both):
1. vocabularyFiles: ARRAY of absolute file paths to .oml vocabulary files
   Example: ["c:/Users/sokhn/OneDrive/Documents/GitHub/sierra-method/src/oml/fireforce6.github.io/sierra/base.oml", "c:/Users/sokhn/OneDrive/Documents/GitHub/sierra-method/src/oml/fireforce6.github.io/sierra/requirement.oml"]
   
2. methodologyName: STRING name like "Sierra" or "Capella"
   Example: "Sierra"

YOU MUST PROVIDE BOTH PARAMETERS. The tool will not work with empty parameters.

EXACT FORMAT REQUIRED:
Call with: {vocabularyFiles: ["path1", "path2", ...], methodologyName: "Name"}

RETURNS:
- List of all bidirectional relations found
- Asks which direction preference: passive voice or active voice
- Ready for next step with extract_methodology_rules`,
    paramsSchema: {
        vocabularyFiles: z.array(z.string()).describe('MUST PROVIDE: Array of absolute file paths to .oml vocabulary files - DO NOT OMIT'),
        methodologyName: z.string().describe('MUST PROVIDE: Methodology name string like "Sierra" - DO NOT OMIT'),
    },
};

interface ExtractedRelation {
    name: string;
    reverseName?: string;
    fromConcept: string;
    toConcept: string;
}

/**
 * Parse a vocabulary file and extract bidirectional relations.
 */
async function parseVocabularyForRelations(filePath: string): Promise<ExtractedRelation[]> {
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
    const relations: ExtractedRelation[] = [];
    
    // Extract relation entities
    for (const member of vocabulary.ownedStatements || []) {
        if (isRelationEntity(member)) {
            const rel = member as RelationEntity;
            
            const fromTypes = rel.sources?.map(s => {
                const ref = s.ref;
                return ref ? ref.name || 'Unknown' : 'Unknown';
            }) || [];
            const toTypes = rel.targets?.map(t => {
                const ref = t.ref;
                return ref ? ref.name || 'Unknown' : 'Unknown';
            }) || [];
            
            if (rel.reverseRelation?.name) {
                relations.push({
                    name: rel.name || 'Unknown',
                    reverseName: rel.reverseRelation.name,
                    fromConcept: fromTypes.join(', ') || 'Unknown',
                    toConcept: toTypes.join(', ') || 'Unknown',
                });
            }
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
            
            if (unrel.reverseRelation?.name) {
                relations.push({
                    name: unrel.name || 'Unknown',
                    reverseName: unrel.reverseRelation.name,
                    fromConcept: fromTypes.join(', ') || 'Unknown',
                    toConcept: toTypes.join(', ') || 'Unknown',
                });
            }
        }
    }
    
    return relations;
}

export const clarifyMethodologyPreferencesHandler = async (params: {
    vocabularyFiles: string[];
    methodologyName: string;
}): Promise<{ content: { type: 'text'; text: string }[]; isError?: boolean }> => {
    try {
        const { vocabularyFiles, methodologyName } = params;
        
        console.error(`[clarify_methodology_preferences] Handler called with ${vocabularyFiles?.length || 0} files, methodology: ${methodologyName}`);
        
        if (!vocabularyFiles || vocabularyFiles.length === 0) {
            console.error(`[clarify_methodology_preferences] ERROR: vocabularyFiles is empty`);
            return {
                content: [{ 
                    type: 'text', 
                    text: `**vocabularyFiles is required.**\n\nProvide an array of absolute paths to vocabulary .oml files.`
                }],
                isError: true,
            };
        }
        
        // Resolve all vocabulary paths
        const vocabularyPaths: string[] = [];
        const missingFiles: string[] = [];
        
        console.error(`[clarify_methodology_preferences] Resolving ${vocabularyFiles.length} vocabulary paths...`);
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
                console.error(`[clarify_methodology_preferences] Path: ${vocabFile} -> ${resolved}`);
                if (fs.existsSync(resolved)) {
                    vocabularyPaths.push(resolved);
                    console.error(`[clarify_methodology_preferences] ✓ File exists: ${resolved}`);
                } else {
                    console.error(`[clarify_methodology_preferences] ✗ File not found: ${resolved}`);
                    missingFiles.push(vocabFile);
                }
            } catch (err) {
                console.error(`[clarify_methodology_preferences] Error resolving ${vocabFile}: ${err}`);
                missingFiles.push(vocabFile);
            }
        }
        
        console.error(`[clarify_methodology_preferences] Found ${vocabularyPaths.length} valid files out of ${vocabularyFiles.length}`);
        if (vocabularyPaths.length === 0) {
            const errMsg = `**No vocabulary files found.**\n\nMissing:\n${missingFiles.map(f => `- ${f}`).join('\n')}`;
            console.error(`[clarify_methodology_preferences] ERROR: ${errMsg}`);
            return {
                content: [{ 
                    type: 'text', 
                    text: errMsg
                }],
                isError: true,
            };
        }
        
        if (missingFiles.length > 0) {
            console.error(`[clarify_methodology_preferences] Warning: ${missingFiles.length} files not found`);
        }
        
        console.error(`[clarify_methodology_preferences] Parsing ${vocabularyPaths.length} vocabulary files`);
        
        // Extract bidirectional relations
        const allRelations: ExtractedRelation[] = [];
        const parsedFiles: string[] = [];
        const errors: string[] = [];
        
        for (const vocabPath of vocabularyPaths) {
            try {
                console.error(`[clarify_methodology_preferences] Parsing: ${vocabPath}`);
                const relations = await parseVocabularyForRelations(vocabPath);
                allRelations.push(...relations);
                parsedFiles.push(vocabPath);
                console.error(`[clarify_methodology_preferences] Found ${relations.length} bidirectional relations`);
            } catch (err) {
                const errorMsg = `Could not parse ${path.basename(vocabPath)}: ${err}`;
                console.error(`[clarify_methodology_preferences] ${errorMsg}`);
                errors.push(errorMsg);
            }
        }
        
        if (parsedFiles.length === 0) {
            const errMsg = `**Failed to parse any vocabulary files.** Tried ${vocabularyPaths.length} files.\n\nErrors:\n${errors.map(e => `- ${e}`).join('\n')}`;
            console.error(`[clarify_methodology_preferences] ERROR: ${errMsg}`);
            return {
                content: [{ 
                    type: 'text', 
                    text: errMsg
                }],
                isError: true,
            };
        }
        
        // Get bidirectional relations (those with reverse names)
        const bidirectionalRelations = allRelations.filter(r => r.reverseName);
        console.error(`[clarify_methodology_preferences] Found ${bidirectionalRelations.length} bidirectional relations out of ${allRelations.length} total`);
        
        if (bidirectionalRelations.length === 0) {
            const errMsg = `**No bidirectional relations found.** The vocabularies don't contain any relations with reverse directions.`;
            console.error(`[clarify_methodology_preferences] ERROR: ${errMsg}`);
            return {
                content: [{ 
                    type: 'text', 
                    text: errMsg
                }],
                isError: true,
            };
        }
        
        // Build the clarification response
        const relationExamples = bidirectionalRelations.slice(0, 5).map(r => 
            `- **${r.name}** ↔ **${r.reverseName}** (${r.fromConcept} ↔ ${r.toConcept})`
        ).join('\n');
        
        const extraRelations = bidirectionalRelations.length > 5 
            ? `- ... and ${bidirectionalRelations.length - 5} more relations` 
            : '';
        
        const summary = [
            `✅ Analyzed ${parsedFiles.length} vocabularies for the **${methodologyName}** methodology.`,
            ``,
            `## Found ${bidirectionalRelations.length} Bidirectional Relations`,
            `These relations have both forward and reverse directions. The methodology playbook will establish which direction is canonical.`,
            ``,
            `**Examples:**`,
            relationExamples,
            extraRelations,
            ``,
            `## Choose Your Preference`,
            `Which convention would you prefer for the methodology?`,
            ``,
            `1. **Passive voice (recommended)** - Use reverse/passive forms`,
            `   - Example: Use "isExpressedBy" instead of "expresses"`,
            `   - Better for clarity and consistency`,
            ``,
            `2. **Active voice** - Use forward/active forms`,
            `   - Example: Use "expresses" instead of "isExpressedBy"`,
            `   - More natural reading direction`,
            ``,
            `Please reply with your preference (e.g., "passive voice for all" or just "passive").`,
        ];
        
        return {
            content: [{ type: 'text', text: summary.join('\n') }],
        };
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error ? error.stack : '';
        console.error(`[clarify_methodology_preferences] CAUGHT EXCEPTION: ${errorMsg}`);
        console.error(stack);
        return {
            content: [{ 
                type: 'text', 
                text: `**Error clarifying methodology preferences:**\n\n${errorMsg}\n\n(Check server logs for full stack trace)` 
            }],
            isError: true,
        };
    }
};
