import { z } from 'zod';
import { loadVocabularyDocument, writeFileAndNotify, findTerm, AnnotationParam, formatAnnotations } from '../common.js';
import { annotationParamSchema } from '../schemas.js';

const paramsSchema = {
    ontology: z.string().describe('File path to the target vocabulary'),
    termName: z.string().describe('Name of the term to update annotations on'),
    annotations: z.array(annotationParamSchema).describe('New annotations to replace existing ones'),
};

export const updateAnnotationTool = {
    name: 'update_annotation' as const,
    description: 'Updates annotations on a term by replacing all existing annotations with the new set.',
    paramsSchema,
};

export const updateAnnotationHandler = async (
    { ontology, termName, annotations }: { ontology: string; termName: string; annotations: AnnotationParam[] }
) => {
    try {
        const { vocabulary, filePath, fileUri, text, eol, indent } = await loadVocabularyDocument(ontology);

        const term = findTerm(vocabulary, termName);
        if (!term || !term.$cstNode) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: `Term "${termName}" not found in vocabulary.` }],
            };
        }

        const termText = text.slice(term.$cstNode.offset, term.$cstNode.end);

        // Remove all existing annotations (lines starting with @)
        const lines = termText.split(/\r?\n/);
        const nonAnnotationLines = [];
        let foundTermDeclaration = false;

        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('@')) {
                continue; // Skip annotation lines
            }
            nonAnnotationLines.push(line);
            if (!foundTermDeclaration && (trimmed.includes('concept') || trimmed.includes('aspect') || 
                trimmed.includes('relation') || trimmed.includes('scalar') || trimmed.includes('property'))) {
                foundTermDeclaration = true;
            }
        }

        // Build new annotations
        const newAnnotationsText = formatAnnotations(annotations, indent, eol);
        
        // Reconstruct term: annotations + rest
        const restOfTerm = nonAnnotationLines.join(eol);
        const updatedTermText = newAnnotationsText + restOfTerm;

        const newContent = text.slice(0, term.$cstNode.offset) + updatedTermText + text.slice(term.$cstNode.end);

        await writeFileAndNotify(filePath, fileUri, newContent);

        return {
            content: [
                { type: 'text' as const, text: `✓ Updated annotations on term "${termName}"` },
            ],
        };
    } catch (error) {
        return {
            isError: true,
            content: [
                { type: 'text' as const, text: `Error updating annotations: ${error instanceof Error ? error.message : String(error)}` },
            ],
        };
    }
};
