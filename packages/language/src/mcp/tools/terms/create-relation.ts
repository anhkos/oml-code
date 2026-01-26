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
import { buildFromToLines, buildForwardReverse, buildRelationFlags } from './text-builders.js';
import { preferencesState } from '../preferences/preferences-state.js';
import { resolveSymbolName, createResolutionErrorResult, type OmlSymbolType } from '../query/index.js';

const paramsSchema = {
    ontology: z.string().describe('File path or file:// URI to the target vocabulary'),
    name: z.string().describe('Relation name to create'),
    sources: z.array(z.string()).optional().describe('Source entities. Can use simple names (auto-resolved) or qualified names (prefix:Name). Use suggest_oml_symbols with symbolType="entity" to discover.'),
    targets: z.array(z.string()).optional().describe('Target entities. Can use simple names (auto-resolved) or qualified names (prefix:Name). Use suggest_oml_symbols with symbolType="entity" to discover.'),
    reverseName: z.string().optional().describe('Reverse role name'),
    functional: z.boolean().optional(),
    inverseFunctional: z.boolean().optional(),
    symmetric: z.boolean().optional(),
    asymmetric: z.boolean().optional(),
    reflexive: z.boolean().optional(),
    irreflexive: z.boolean().optional(),
    transitive: z.boolean().optional(),
    annotations: z.array(annotationParamSchema).optional(),
};

export const createRelationTool = {
    name: 'create_relation' as const,
    description: `[DEFAULT - USE THIS FOR ALL RELATIONS] Creates a relation between entities. This is the standard and recommended way to define relationships in OML. ALWAYS use this tool for creating relations unless the user explicitly requests a "relation entity". Relations have from/to entities and an optional reverse name.

TIP: Use suggest_oml_symbols with symbolType="entity" to discover available entities for sources/targets.
If a simple name (without prefix) matches multiple symbols, you'll be prompted to disambiguate.`,
    paramsSchema,
};

// Keep the old name as an alias for backwards compatibility
export const createUnreifiedRelationTool = createRelationTool;

export const createRelationHandler = async (
    params: {
        ontology: string;
        name: string;
        sources?: string[];
        targets?: string[];
        reverseName?: string;
        functional?: boolean;
        inverseFunctional?: boolean;
        symmetric?: boolean;
        asymmetric?: boolean;
        reflexive?: boolean;
        irreflexive?: boolean;
        transitive?: boolean;
        annotations?: AnnotationParam[];
    }
) => {
    const {
        ontology,
        name,
        sources,
        targets,
        reverseName,
        functional,
        inverseFunctional,
        symmetric,
        asymmetric,
        reflexive,
        irreflexive,
        transitive,
        annotations,
    } = params;

    try {
        const { vocabulary, filePath, fileUri, text, eol, indent } = await loadVocabularyDocument(ontology);

        // Resolve sources and targets - support both simple names and qualified names
        const entityTypes: OmlSymbolType[] = ['concept', 'aspect', 'relation_entity'];
        const resolvedSources: string[] = [];
        const resolvedTargets: string[] = [];
        
        if (sources && sources.length > 0) {
            for (const src of sources) {
                const resolution = await resolveSymbolName(src, fileUri, entityTypes);
                if (!resolution.success) {
                    return createResolutionErrorResult(resolution, src, 'source entity');
                }
                resolvedSources.push(stripLocalPrefix(resolution.qualifiedName!, vocabulary.prefix));
            }
        }
        
        if (targets && targets.length > 0) {
            for (const tgt of targets) {
                const resolution = await resolveSymbolName(tgt, fileUri, entityTypes);
                if (!resolution.success) {
                    return createResolutionErrorResult(resolution, tgt, 'target entity');
                }
                resolvedTargets.push(stripLocalPrefix(resolution.qualifiedName!, vocabulary.prefix));
            }
        }

        // Validate all referenced prefixes are imported
        const existingPrefixes = collectImportPrefixes(text, vocabulary.prefix);
        const allReferencedNames = [
            ...resolvedSources,
            ...resolvedTargets,
            ...(annotations?.map(a => a.property) ?? []),
        ];
        const prefixError = validateReferencedPrefixes(allReferencedNames, existingPrefixes, 'Cannot create relation with unresolved references.');
        if (prefixError) return prefixError;

        if (findTerm(vocabulary, name)) {
            return {
                isError: true,
                content: [
                    { type: 'text' as const, text: `Relation "${name}" already exists in the vocabulary.` },
                ],
            };
        }

        const innerIndent = indent + indent;
        const annotationsText = formatAnnotations(annotations, indent, eol);

        let body = '';
        body += buildFromToLines(resolvedSources.length > 0 ? resolvedSources : undefined, resolvedTargets.length > 0 ? resolvedTargets : undefined, innerIndent, eol);
        body += buildForwardReverse(undefined, reverseName, innerIndent, eol);
        body += buildRelationFlags(
            { functional, inverseFunctional, symmetric, asymmetric, reflexive, irreflexive, transitive },
            innerIndent,
            eol
        );

        const block = body ? ` [${eol}${body}${indent}]` : '';
        const relationText = `${annotationsText}${indent}relation ${name}${block}${eol}${eol}`;

        const newContent = insertBeforeClosingBrace(text, relationText);
        await writeFileAndNotify(filePath, fileUri, newContent);

        const result = {
            content: [
                { type: 'text' as const, text: `✓ Created relation "${name}"\n\nGenerated code:\n${relationText.trim()}` },
            ],
        };

        // Run validation if safe mode is enabled
        const safeMode = preferencesState.getPreferences().safeMode ?? false;
        return appendValidationIfSafeMode(result, fileUri, safeMode);
    } catch (error) {
        return {
            isError: true,
            content: [
                { type: 'text' as const, text: `Error creating relation: ${error instanceof Error ? error.message : String(error)}` },
            ],
        };
    }
};

// Keep the old names as aliases for backwards compatibility
export const createUnreifiedRelationHandler = createRelationHandler;