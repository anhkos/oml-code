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
import { preferencesState } from '../preferences/preferences-state.js';

const paramsSchema = {
    ontology: z.string().describe('File path or file:// URI to the target vocabulary'),
    name: z.string().describe('Annotation property name to create'),
    annotations: z.array(annotationParamSchema).optional(),
};

export const createAnnotationPropertyTool = {
    name: 'create_annotation_property' as const,
    description: 'Creates an annotation property.',
    paramsSchema,
};

export const createAnnotationPropertyHandler = async (
    { ontology, name, annotations }: { ontology: string; name: string; annotations?: AnnotationParam[] }
) => {
    try {
        const { vocabulary, filePath, fileUri, text, eol, indent } = await loadVocabularyDocument(ontology);

        // Validate all referenced prefixes are imported
        const existingPrefixes = collectImportPrefixes(text, vocabulary.prefix);
        const allReferencedNames = annotations?.map(a => a.property) ?? [];
        const prefixError = validateReferencedPrefixes(allReferencedNames, existingPrefixes, 'Cannot create annotation property with unresolved references.');
        if (prefixError) return prefixError;

        if (findTerm(vocabulary, name)) {
            return {
                isError: true,
                content: [
                    { type: 'text' as const, text: `Annotation property "${name}" already exists in the vocabulary.` },
                ],
            };
        }

        const annotationsText = formatAnnotations(annotations, indent, eol);
        const propertyText = `${annotationsText}${indent}annotation property ${name}${eol}${eol}`;

        const newContent = insertBeforeClosingBrace(text, propertyText);
        await writeFileAndNotify(filePath, fileUri, newContent);

        const result = {
            content: [
                { type: 'text' as const, text: `✓ Created annotation property "${name}"\n\nGenerated code:\n${propertyText.trim()}` },
            ],
        };

        // Run validation if safe mode is enabled
        const safeMode = preferencesState.getPreferences().safeMode ?? false;
        return appendValidationIfSafeMode(result, fileUri, safeMode);
    } catch (error) {
        return {
            isError: true,
            content: [
                { type: 'text' as const, text: `Error creating annotation property: ${error instanceof Error ? error.message : String(error)}` },
            ],
        };
    }
};
