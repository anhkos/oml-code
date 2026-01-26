import { z } from 'zod';
import {
    AnnotationParam,
    LiteralParam,
    insertBeforeClosingBrace,
    loadVocabularyDocument,
    writeFileAndNotify,
    findTerm,
    formatAnnotations,
    formatLiteral,
    collectImportPrefixes,
    validateReferencedPrefixes,
    appendValidationIfSafeMode,
} from '../common.js';
import { annotationParamSchema, literalParamSchema } from '../schemas.js';
import { preferencesState } from '../preferences/preferences-state.js';

const paramsSchema = {
    ontology: z.string().describe('File path or file:// URI to the target vocabulary'),
    name: z.string().describe('Scalar name to create'),
    literalEnumeration: z.array(literalParamSchema).optional().describe('Optional literal enumeration (oneOf)'),
    annotations: z.array(annotationParamSchema).optional(),
};

export const createScalarTool = {
    name: 'create_scalar' as const,
    description: 'Creates a scalar with optional literal enumeration.',
    paramsSchema,
};

export const createScalarHandler = async (
    { ontology, name, literalEnumeration, annotations }: { ontology: string; name: string; literalEnumeration?: LiteralParam[]; annotations?: AnnotationParam[] }
) => {
    try {
        const { vocabulary, filePath, fileUri, text, eol, indent } = await loadVocabularyDocument(ontology);

        // Validate all referenced prefixes are imported
        const existingPrefixes = collectImportPrefixes(text, vocabulary.prefix);
        const allReferencedNames = annotations?.map(a => a.property) ?? [];
        const prefixError = validateReferencedPrefixes(allReferencedNames, existingPrefixes, 'Cannot create scalar with unresolved references.');
        if (prefixError) return prefixError;

        if (findTerm(vocabulary, name)) {
            return {
                isError: true,
                content: [
                    { type: 'text' as const, text: `Scalar "${name}" already exists in the vocabulary.` },
                ],
            };
        }

        const innerIndent = indent + indent;
        const annotationsText = formatAnnotations(annotations, indent, eol);

        let block = '';
        if (literalEnumeration && literalEnumeration.length > 0) {
            const literals = literalEnumeration.map(formatLiteral).join(', ');
            block = ` [${eol}${innerIndent}oneOf ${literals}${eol}${indent}]`;
        }

        const scalarText = `${annotationsText}${indent}scalar ${name}${block}${eol}${eol}`;
        const newContent = insertBeforeClosingBrace(text, scalarText);
        await writeFileAndNotify(filePath, fileUri, newContent);

        const result = {
            content: [
                { type: 'text' as const, text: `✓ Created scalar "${name}"\n\nGenerated code:\n${scalarText.trim()}` },
            ],
        };

        // Run validation if safe mode is enabled
        const safeMode = preferencesState.getPreferences().safeMode ?? false;
        return appendValidationIfSafeMode(result, fileUri, safeMode);
    } catch (error) {
        return {
            isError: true,
            content: [
                { type: 'text' as const, text: `Error creating scalar: ${error instanceof Error ? error.message : String(error)}` },
            ],
        };
    }
};
