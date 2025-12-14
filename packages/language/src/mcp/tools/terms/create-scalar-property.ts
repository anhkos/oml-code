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
import { buildDomains, buildRanges } from './text-builders.js';

const paramsSchema = {
    ontology: z.string().describe('File path or file:// URI to the target vocabulary'),
    name: z.string().describe('Scalar property name to create'),
    domains: z.array(z.string()).optional().describe('Domain entities'),
    ranges: z.array(z.string()).optional().describe('Range scalars'),
    functional: z.boolean().optional(),
    annotations: z.array(annotationParamSchema).optional(),
};

export const createScalarPropertyTool = {
    name: 'create_scalar_property' as const,
    description: 'Creates a scalar property with optional domains, ranges, and functional modifier.',
    paramsSchema,
};

export const createScalarPropertyHandler = async (
    { ontology, name, domains, ranges, functional, annotations }: { ontology: string; name: string; domains?: string[]; ranges?: string[]; functional?: boolean; annotations?: AnnotationParam[] }
) => {
    try {
        const { vocabulary, filePath, fileUri, text, eol, indent } = await loadVocabularyDocument(ontology);

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
        body += buildDomains(domains, innerIndent, eol);
        body += buildRanges(ranges, innerIndent, eol);
        if (functional) {
            body += `${innerIndent}functional${eol}`;
        }

        const block = body ? ` [${eol}${body}${indent}]` : '';
        const propertyText = `${annotationsText}${indent}scalar property ${name}${block}${eol}${eol}`;

        const newContent = insertBeforeClosingBrace(text, propertyText);
        await writeFileAndNotify(filePath, fileUri, newContent);

        return {
            content: [
                { type: 'text' as const, text: `✓ Created scalar property "${name}"\n\nGenerated code:\n${propertyText.trim()}` },
            ],
        };
    } catch (error) {
        return {
            isError: true,
            content: [
                { type: 'text' as const, text: `Error creating scalar property: ${error instanceof Error ? error.message : String(error)}` },
            ],
        };
    }
};
