import { z } from 'zod';
import {
    AnnotationParam,
    insertBeforeClosingBrace,
    loadVocabularyDocument,
    writeFileAndNotify,
    findTerm,
    formatAnnotations,
} from '../common.js';
import { annotationParamSchema } from '../schemas.js';

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

        return {
            content: [
                { type: 'text' as const, text: `✓ Created annotation property "${name}"\n\nGenerated code:\n${propertyText.trim()}` },
            ],
        };
    } catch (error) {
        return {
            isError: true,
            content: [
                { type: 'text' as const, text: `Error creating annotation property: ${error instanceof Error ? error.message : String(error)}` },
            ],
        };
    }
};
