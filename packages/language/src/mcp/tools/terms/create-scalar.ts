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
} from '../common.js';
import { annotationParamSchema, literalParamSchema } from '../schemas.js';

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

        return {
            content: [
                { type: 'text' as const, text: `✓ Created scalar "${name}"\n\nGenerated code:\n${scalarText.trim()}` },
            ],
        };
    } catch (error) {
        return {
            isError: true,
            content: [
                { type: 'text' as const, text: `Error creating scalar: ${error instanceof Error ? error.message : String(error)}` },
            ],
        };
    }
};
