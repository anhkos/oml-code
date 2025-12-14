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
import { buildFromToLines, buildForwardReverse, buildRelationFlags } from './text-builders.js';

const paramsSchema = {
    ontology: z.string().describe('File path or file:// URI to the target vocabulary'),
    name: z.string().describe('Relation name to create'),
    sources: z.array(z.string()).optional().describe('Source entities'),
    targets: z.array(z.string()).optional().describe('Target entities'),
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

export const createUnreifiedRelationTool = {
    name: 'create_unreified_relation' as const,
    description: 'Creates an unreified relation with optional roles and characteristics.',
    paramsSchema,
};

export const createUnreifiedRelationHandler = async (
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
        body += buildFromToLines(sources, targets, innerIndent, eol);
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

        return {
            content: [
                { type: 'text' as const, text: `✓ Created relation "${name}"\n\nGenerated code:\n${relationText.trim()}` },
            ],
        };
    } catch (error) {
        return {
            isError: true,
            content: [
                { type: 'text' as const, text: `Error creating relation: ${error instanceof Error ? error.message : String(error)}` },
            ],
        };
    }
};
