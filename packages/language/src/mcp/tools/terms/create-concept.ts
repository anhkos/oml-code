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
import { buildInstanceEnumeration, buildKeyLines } from './text-builders.js';

const paramsSchema = {
    ontology: z.string().describe('File path or file:// URI to the target vocabulary'),
    name: z.string().describe('Concept name to create'),
    keys: z.array(z.array(z.string())).optional().describe('Optional key property groups'),
    instanceEnumeration: z.array(z.string()).optional().describe('Optional instance enumeration list'),
    superTerms: z.array(z.string()).optional().describe('Optional specialization super terms to attach to the concept header'),
    annotations: z.array(annotationParamSchema).optional(),
};

export const createConceptTool = {
    name: 'create_concept' as const,
    description: 'Creates a concept in the target vocabulary, with optional keys and instance enumeration.',
    paramsSchema,
};

export const createConceptHandler = async (
    { ontology, name, keys, instanceEnumeration, superTerms, annotations }: { ontology: string; name: string; keys?: string[][]; instanceEnumeration?: string[]; superTerms?: string[]; annotations?: AnnotationParam[] }
) => {
    try {
        const { vocabulary, filePath, fileUri, text, eol, indent } = await loadVocabularyDocument(ontology);

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

        const specializationText = superTerms && superTerms.length > 0 ? ` < ${Array.from(new Set(superTerms)).join(', ')}` : '';
        const block = hasBlock ? ` [${eol}${enumerationText}${keyText}${indent}]` : '';
        const conceptText = `${annotationsText}${indent}concept ${name}${specializationText}${block}${eol}${eol}`;

        const newContent = insertBeforeClosingBrace(text, conceptText);
        await writeFileAndNotify(filePath, fileUri, newContent);

        return {
            content: [
                {
                    type: 'text' as const,
                    text: `✓ Created concept "${name}"\n\nGenerated code:\n${conceptText.trim()}`,
                },
            ],
        };
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
