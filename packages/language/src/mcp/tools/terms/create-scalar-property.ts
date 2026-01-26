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
import { buildDomains, buildRanges } from './text-builders.js';
import { preferencesState } from '../preferences/preferences-state.js';
import { resolveSymbolName, createResolutionErrorResult, type OmlSymbolType } from '../query/index.js';

const paramsSchema = {
    ontology: z.string().describe('File path or file:// URI to the target vocabulary'),
    name: z.string().describe('Scalar property name to create'),
    domains: z.array(z.string()).optional().describe('Domain entities. Can use simple names (auto-resolved) or qualified names. Use suggest_oml_symbols with symbolType="entity" to discover.'),
    ranges: z.array(z.string()).optional().describe('Range scalars (e.g., xsd:string, xsd:integer). Can use simple names (auto-resolved) or qualified names. Use suggest_oml_symbols with symbolType="scalar" to discover.'),
    functional: z.boolean().optional(),
    annotations: z.array(annotationParamSchema).optional(),
};

export const createScalarPropertyTool = {
    name: 'create_scalar_property' as const,
    description: `Creates a scalar property with optional domains, ranges, and functional modifier.

TIP: Use suggest_oml_symbols with symbolType="entity" to discover available entities for domains.
Use suggest_oml_symbols with symbolType="scalar" to discover available scalars for ranges.
If a simple name (without prefix) matches multiple symbols, you'll be prompted to disambiguate.`,
    paramsSchema,
};

export const createScalarPropertyHandler = async (
    { ontology, name, domains, ranges, functional, annotations }: { ontology: string; name: string; domains?: string[]; ranges?: string[]; functional?: boolean; annotations?: AnnotationParam[] }
) => {
    try {
        const { vocabulary, filePath, fileUri, text, eol, indent } = await loadVocabularyDocument(ontology);

        // Resolve domains (entities) and ranges (scalars)
        const entityTypes: OmlSymbolType[] = ['concept', 'aspect', 'relation_entity'];
        const scalarTypes: OmlSymbolType[] = ['scalar'];
        const resolvedDomains: string[] = [];
        const resolvedRanges: string[] = [];
        
        if (domains && domains.length > 0) {
            for (const dom of domains) {
                const resolution = await resolveSymbolName(dom, fileUri, entityTypes);
                if (!resolution.success) {
                    return createResolutionErrorResult(resolution, dom, 'domain entity');
                }
                resolvedDomains.push(stripLocalPrefix(resolution.qualifiedName!, vocabulary.prefix));
            }
        }
        
        if (ranges && ranges.length > 0) {
            for (const rng of ranges) {
                const resolution = await resolveSymbolName(rng, fileUri, scalarTypes);
                if (!resolution.success) {
                    return createResolutionErrorResult(resolution, rng, 'range scalar');
                }
                resolvedRanges.push(stripLocalPrefix(resolution.qualifiedName!, vocabulary.prefix));
            }
        }

        // Validate all referenced prefixes are imported
        const existingPrefixes = collectImportPrefixes(text, vocabulary.prefix);
        const allReferencedNames = [
            ...resolvedDomains,
            ...resolvedRanges,
            ...(annotations?.map(a => a.property) ?? []),
        ];
        const prefixError = validateReferencedPrefixes(allReferencedNames, existingPrefixes, 'Cannot create scalar property with unresolved references.');
        if (prefixError) return prefixError;

        if (findTerm(vocabulary, name)) {
            return {
                isError: true,
                content: [
                    { type: 'text' as const, text: `Scalar property "${name}" already exists in the vocabulary.` },
                ],
            };
        }

        const innerIndent = indent + indent;
        const annotationsText = formatAnnotations(annotations, indent, eol);

        let body = '';
        body += buildDomains(resolvedDomains.length > 0 ? resolvedDomains : undefined, innerIndent, eol);
        body += buildRanges(resolvedRanges.length > 0 ? resolvedRanges : undefined, innerIndent, eol);
        if (functional) {
            body += `${innerIndent}functional${eol}`;
        }

        const block = body ? ` [${eol}${body}${indent}]` : '';
        const propertyText = `${annotationsText}${indent}scalar property ${name}${block}${eol}${eol}`;

        const newContent = insertBeforeClosingBrace(text, propertyText);
        await writeFileAndNotify(filePath, fileUri, newContent);

        const result = {
            content: [
                { type: 'text' as const, text: `✓ Created scalar property "${name}"\n\nGenerated code:\n${propertyText.trim()}` },
            ],
        };

        // Run validation if safe mode is enabled
        const safeMode = preferencesState.getPreferences().safeMode ?? false;
        return appendValidationIfSafeMode(result, fileUri, safeMode);
    } catch (error) {
        return {
            isError: true,
            content: [
                { type: 'text' as const, text: `Error creating scalar property: ${error instanceof Error ? error.message : String(error)}` },
            ],
        };
    }
};
