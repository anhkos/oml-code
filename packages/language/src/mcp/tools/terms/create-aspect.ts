import { z } from 'zod';
import {
    AnnotationParam,
    insertBeforeClosingBrace,
    loadVocabularyDocument,
    writeFileAndNotify,
    findTerm,
    formatAnnotations,
    collectImportPrefixes,
    validateReferencedPrefixes,
    appendValidationIfSafeMode,
} from '../common.js';
import { annotationParamSchema } from '../schemas.js';
import { buildKeyLines } from './text-builders.js';
import { preferencesState } from '../preferences/preferences-state.js';

const paramsSchema = {
    ontology: z.string().describe('File path or file:// URI to the target vocabulary'),
    name: z.string().describe('Aspect name to create'),
    keys: z.array(z.array(z.string())).optional().describe('Optional key property groups'),
    annotations: z.array(annotationParamSchema).optional(),
};

export const createAspectTool = {
    name: 'create_aspect' as const,
    description: 'Creates an aspect in the target vocabulary, with optional key axioms.',
    paramsSchema,
};

export const createAspectHandler = async (
    { ontology, name, keys, annotations }: { ontology: string; name: string; keys?: string[][]; annotations?: AnnotationParam[] }
) => {
    try {
        const { vocabulary, filePath, fileUri, text, eol, indent } = await loadVocabularyDocument(ontology);

        // Validate all referenced prefixes are imported
        const existingPrefixes = collectImportPrefixes(text, vocabulary.prefix);
        const allReferencedNames = [
            ...(keys?.flat() ?? []),
            ...(annotations?.map(a => a.property) ?? []),
        ];
        const prefixError = validateReferencedPrefixes(allReferencedNames, existingPrefixes, 'Cannot create aspect with unresolved references.');
        if (prefixError) return prefixError;

        if (findTerm(vocabulary, name)) {
            return {
                isError: true,
                content: [
                    { type: 'text' as const, text: `Aspect "${name}" already exists in the vocabulary.` },
                ],
            };
        }

        const innerIndent = indent + indent;
        const annotationsText = formatAnnotations(annotations, indent, eol);
        const keyText = buildKeyLines(keys, innerIndent, eol);
        const block = keyText ? ` [${eol}${keyText}${indent}]` : '';

        const aspectText = `${annotationsText}${indent}aspect ${name}${block}${eol}${eol}`;
        const newContent = insertBeforeClosingBrace(text, aspectText);
        await writeFileAndNotify(filePath, fileUri, newContent);

        const result = {
            content: [
                { type: 'text' as const, text: `✓ Created aspect "${name}"\n\nGenerated code:\n${aspectText.trim()}` },
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
                    text: `Error creating aspect: ${error instanceof Error ? error.message : String(error)}`,
                },
            ],
        };
    }
};
