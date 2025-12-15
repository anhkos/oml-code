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
import { buildFromToLines, buildForwardReverse, buildRelationFlags, buildKeyLines } from './text-builders.js';

const paramsSchema = {
    ontology: z.string().describe('File path or file:// URI to the target vocabulary'),
    name: z.string().describe('Relation entity name to create'),
    sources: z.array(z.string()).optional().describe('Source entities'),
    targets: z.array(z.string()).optional().describe('Target entities'),
    forwardName: z.string().optional().describe('Forward role name'),
    reverseName: z.string().optional().describe('Reverse role name'),
    functional: z.boolean().optional(),
    inverseFunctional: z.boolean().optional(),
    symmetric: z.boolean().optional(),
    asymmetric: z.boolean().optional(),
    reflexive: z.boolean().optional(),
    irreflexive: z.boolean().optional(),
    transitive: z.boolean().optional(),
    keys: z.array(z.array(z.string())).optional(),
    superTerms: z.array(z.string()).optional().describe('Optional specialization super terms to attach to the relation entity'),
    annotations: z.array(annotationParamSchema).optional(),
};

export const createRelationEntityTool = {
    name: 'create_relation_entity' as const,
    description: 'Creates a relation entity with optional roles, characteristics, and keys.',
    paramsSchema,
};

export const createRelationEntityHandler = async (
    params: {
        ontology: string;
        name: string;
        sources?: string[];
        targets?: string[];
        forwardName?: string;
        reverseName?: string;
        functional?: boolean;
        inverseFunctional?: boolean;
        symmetric?: boolean;
        asymmetric?: boolean;
        reflexive?: boolean;
        irreflexive?: boolean;
        transitive?: boolean;
        keys?: string[][];
        superTerms?: string[];
        annotations?: AnnotationParam[];
    }
) => {
    const {
        ontology,
        name,
        sources,
        targets,
        forwardName,
        reverseName,
        functional,
        inverseFunctional,
        symmetric,
        asymmetric,
        reflexive,
        irreflexive,
        transitive,
        keys,
        annotations,
    } = params;

    try {
        const { vocabulary, filePath, fileUri, text, eol, indent } = await loadVocabularyDocument(ontology);

        if (findTerm(vocabulary, name)) {
            return {
                isError: true,
                content: [
                    { type: 'text' as const, text: `Relation entity "${name}" already exists in the vocabulary.` },
                ],
            };
        }

        const innerIndent = indent + indent;
        const annotationsText = formatAnnotations(annotations, indent, eol);

        let body = '';
        body += buildFromToLines(sources, targets, innerIndent, eol);
        body += buildForwardReverse(forwardName, reverseName, innerIndent, eol);
        body += buildRelationFlags(
            { functional, inverseFunctional, symmetric, asymmetric, reflexive, irreflexive, transitive },
            innerIndent,
            eol
        );
        body += buildKeyLines(keys, innerIndent, eol);

        const block = body ? ` [${eol}${body}${indent}]` : '';
        const specializationText = params.superTerms && params.superTerms.length > 0 ? ` < ${Array.from(new Set(params.superTerms)).join(', ')}` : '';
        // For relation entity, specialization appears after the block per style
        const relationText = `${annotationsText}${indent}relation entity ${name}${block}${specializationText}${eol}${eol}`;

        const newContent = insertBeforeClosingBrace(text, relationText);
        await writeFileAndNotify(filePath, fileUri, newContent);

        return {
            content: [
                { type: 'text' as const, text: `✓ Created relation entity "${name}"\n\nGenerated code:\n${relationText.trim()}` },
            ],
        };
    } catch (error) {
        return {
            isError: true,
            content: [
                { type: 'text' as const, text: `Error creating relation entity: ${error instanceof Error ? error.message : String(error)}` },
            ],
        };
    }
};
