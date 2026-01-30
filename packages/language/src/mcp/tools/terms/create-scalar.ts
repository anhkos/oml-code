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
    appendValidationIfSafeMode,
} from '../common.js';
import { annotationParamSchema, literalParamSchema } from '../schemas.js';
import { preferencesState } from '../preferences/preferences-state.js';
import { ensureImportsHandler } from '../methodology/ensure-imports.js';

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

        // Collect all referenced prefixes
        const allReferencedNames = annotations?.map(a => a.property) ?? [];
        const referencedPrefixes = new Set<string>();
        for (const ref of allReferencedNames) {
            if (ref.includes(':')) {
                referencedPrefixes.add(ref.split(':')[0]);
            }
        }

        // Check which prefixes are missing
        let existingPrefixes = collectImportPrefixes(text, vocabulary.prefix);
        const missing = [...referencedPrefixes].filter(p => !existingPrefixes.has(p));
        
        // Auto-add missing imports
        let currentText = text;
        let currentFilePath = filePath;
        let currentFileUri = fileUri;
        
        if (missing.length > 0) {
            const ensureResult = await ensureImportsHandler({ ontology });
            if (ensureResult.isError) {
                return ensureResult;
            }
            // Reload the document to get updated content with new imports
            const reloaded = await loadVocabularyDocument(ontology);
            currentText = reloaded.text;
            currentFilePath = reloaded.filePath;
            currentFileUri = reloaded.fileUri;
        }

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
        const newContent = insertBeforeClosingBrace(currentText, scalarText);
        await writeFileAndNotify(currentFilePath, currentFileUri, newContent);

        const notes: string[] = [];
        if (missing.length > 0) {
            notes.push(`Auto-added imports for: ${missing.join(', ')}.`);
        }

        const result = {
            content: [
                { type: 'text' as const, text: `✓ Created scalar "${name}"${notes.length ? '\n' + notes.join(' ') : ''}\n\nGenerated code:\n${scalarText.trim()}` },
            ],
        };

        // Run validation if safe mode is enabled
        const safeMode = preferencesState.getPreferences().safeMode ?? false;
        return appendValidationIfSafeMode(result, currentFileUri, safeMode);
    } catch (error) {
        return {
            isError: true,
            content: [
                { type: 'text' as const, text: `Error creating scalar: ${error instanceof Error ? error.message : String(error)}` },
            ],
        };
    }
};
