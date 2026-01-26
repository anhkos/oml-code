import { z } from 'zod';
import {
    AnnotationParam,
    insertBeforeClosingBrace,
    loadVocabularyDocument,
    writeFileAndNotify,
    findTerm,
    formatAnnotations,
    stripLocalPrefix,
    collectImportPrefixes,
    validateReferencedPrefixes,
    appendValidationIfSafeMode,
} from '../common.js';
import { annotationParamSchema } from '../schemas.js';
import { buildInstanceEnumeration, buildKeyLines } from './text-builders.js';
import { preferencesState } from '../preferences/preferences-state.js';
import { resolveSymbolName, createResolutionErrorResult, type OmlSymbolType } from '../query/index.js';

const paramsSchema = {
    ontology: z.string().describe('File path to a VOCABULARY file (not description). Concepts can only be defined in vocabularies.'),
    name: z.string().describe('Concept name to create (must start with capital letter, e.g., "Stakeholder", "Requirement")'),
    keys: z.array(z.array(z.string())).optional().describe('Optional key property groups'),
    instanceEnumeration: z.array(z.string()).optional().describe('Optional instance enumeration list'),
    superTerms: z.array(z.string()).optional().describe('Optional parent concepts/aspects this concept specializes. Can use simple names (auto-resolved) or qualified names (prefix:Name). Use suggest_oml_symbols with symbolType="entity" to discover available concepts/aspects.'),
    annotations: z.array(annotationParamSchema).optional(),
};

export const createConceptTool = {
    name: 'create_concept' as const,
    description: `Creates a concept (type definition) in a VOCABULARY file.

IMPORTANT: This tool is for VOCABULARY files only. Use this for defining reusable TYPES, not specific individuals.

For DESCRIPTION MODELING (creating specific instances like "MissionCommander"):
- Do NOT use this tool
- Instead use create_concept_instance in a description file
- Reference existing concepts from vocabularies (e.g., requirement:Stakeholder)

TIP: Use suggest_oml_symbols with symbolType="entity" to discover available concepts/aspects for superTerms.
If a simple name (without prefix) matches multiple symbols, you'll be prompted to disambiguate.

Example: "concept Stakeholder" defines a TYPE that can have instances.`,
    paramsSchema,
};

export const createConceptHandler = async (
    { ontology, name, keys, instanceEnumeration, superTerms, annotations }: { ontology: string; name: string; keys?: string[][]; instanceEnumeration?: string[]; superTerms?: string[]; annotations?: AnnotationParam[] }
) => {
    try {
        // Ensure concept name starts with capital letter
        if (!/^[A-Z]/.test(name)) {
            return {
                isError: true,
                content: [
                    {
                        type: 'text' as const,
                        text: `Concept name "${name}" must start with a capital letter. OML convention requires concept names to begin with an uppercase character.`,
                    },
                ],
            };
        }

        const { vocabulary, filePath, fileUri, text, eol, indent } = await loadVocabularyDocument(ontology);
        
        // Resolve superTerms - support both simple names and qualified names
        const resolvedSuperTerms: string[] = [];
        if (superTerms && superTerms.length > 0) {
            const entityTypes: OmlSymbolType[] = ['concept', 'aspect', 'relation_entity'];
            for (const st of superTerms) {
                const resolution = await resolveSymbolName(st, fileUri, entityTypes);
                if (!resolution.success) {
                    return createResolutionErrorResult(resolution, st);
                }
                resolvedSuperTerms.push(resolution.qualifiedName!);
            }
        }
        
        // Strip local prefix from resolved superTerms to prevent self-referential qualified names
        // E.g., "capability:Capability" in the "capability" vocabulary becomes just "Capability"
        const normalizedSuperTerms = resolvedSuperTerms.map(st => stripLocalPrefix(st, vocabulary.prefix));

        // Validate all referenced prefixes are imported
        const existingPrefixes = collectImportPrefixes(text, vocabulary.prefix);
        const allReferencedNames = [
            ...(normalizedSuperTerms ?? []),
            ...(keys?.flat() ?? []),
            ...(annotations?.map(a => a.property) ?? []),
        ];
        const prefixError = validateReferencedPrefixes(allReferencedNames, existingPrefixes, 'Cannot create concept with unresolved references.');
        if (prefixError) return prefixError;

        if (findTerm(vocabulary, name)) {
            return {
                isError: true,
                content: [
                    {
                        type: 'text' as const,
                        text: `Concept "${name}" already exists in the vocabulary.`,
                    },
                ],
            };
        }

        const innerIndent = indent + indent;
        const annotationsText = formatAnnotations(annotations, indent, eol);

        const enumerationText = buildInstanceEnumeration(instanceEnumeration, innerIndent, eol);
        const keyText = buildKeyLines(keys, innerIndent, eol);
        const hasBlock = Boolean(enumerationText || keyText);

        const specializationText = normalizedSuperTerms && normalizedSuperTerms.length > 0 ? ` < ${Array.from(new Set(normalizedSuperTerms)).join(', ')}` : '';
        const block = hasBlock ? ` [${eol}${enumerationText}${keyText}${indent}]` : '';
        const conceptText = `${annotationsText}${indent}concept ${name}${specializationText}${block}${eol}${eol}`;

        const newContent = insertBeforeClosingBrace(text, conceptText);
        await writeFileAndNotify(filePath, fileUri, newContent);

        const result = {
            content: [
                {
                    type: 'text' as const,
                    text: `✓ Created concept "${name}"\n\nGenerated code:\n${conceptText.trim()}`,
                },
            ],
        };

        // Run validation if safe mode is enabled
        const safeMode = preferencesState.getPreferences().safeMode ?? false;
        return appendValidationIfSafeMode(result, fileUri, safeMode);
    } catch (error) {
        return {
            isError: true,
            content: [
                {
                    type: 'text' as const,
                    text: `Error creating concept: ${error instanceof Error ? error.message : String(error)}`,
                },
            ],
        };
    }
};
