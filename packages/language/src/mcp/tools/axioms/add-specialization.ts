import { z } from 'zod';
import { loadVocabularyDocument, writeFileAndNotify, findTerm, detectIndentation } from '../common.js';

const paramsSchema = {
    ontology: z.string().describe('File path or file:// URI to the target vocabulary'),
    term: z.string().describe('Term to specialize'),
    superTerms: z.array(z.string()).nonempty().describe('Super terms to add'),
    suggestionIndex: z.number().optional().describe('[RECOMMENDED] Index from suggest_super_concepts output (1-based). Helps ensure correct choice.'),
    importStatement: z.string().optional().describe('[Optional] Import statement to add if required (from suggest_super_concepts additionalTextEdits)'),
};

export const addSpecializationTool = {
    name: 'add_specialization' as const,
    description: 'Adds super terms to a term\'s specialization clause. MUST be called AFTER suggest_super_concepts and ONLY with concepts that exist in that suggestion list. The suggestionIndex parameter MUST reference the user\'s chosen option. DO NOT call this with newly created concepts - only use existing ones from suggestions. If the chosen suggestion includes an importStatement, pass it so the tool can add the needed import automatically.',
    paramsSchema,
};

function extractSpecialization(termText: string) {
    const idx = termText.indexOf('<');
    if (idx === -1) return { exists: false } as const;

    let end = termText.length;
    const nextBracket = termText.indexOf('[', idx + 1);
    const nextEquals = termText.indexOf('=', idx + 1);
    if (nextBracket !== -1) end = Math.min(end, nextBracket);
    if (nextEquals !== -1) end = Math.min(end, nextEquals);

    const segment = termText.slice(idx + 1, end).trim();
    const items = segment.length === 0 ? [] : segment.split(',').map((s) => s.trim()).filter(Boolean);

    return { exists: true, start: idx, end, items } as const;
}

export const addSpecializationHandler = async ({ ontology, term, superTerms, suggestionIndex, importStatement }: { ontology: string; term: string; superTerms: string[]; suggestionIndex?: number; importStatement?: string }) => {
    try {
        // Warn if called without suggestionIndex (implies suggest_super_concepts wasn't called)
        if (suggestionIndex === undefined) {
            console.warn(
                `[add_specialization] WARNING: suggestionIndex not provided! ` +
                `This indicates suggest_super_concepts was not called first, or the workflow was bypassed. ` +
                `Concepts may have been created instead of using existing workspace concepts.`
            );
            // Return an error to block the operation
            return {
                isError: true,
                content: [
                    { type: 'text' as const, text: `⚠️ Error: suggestionIndex is required. You must call suggest_super_concepts first and get user confirmation before adding specialization. Do not create new concepts - only use existing ones from suggestions.` },
                ],
            };
        }
        const needsImport = importStatement && importStatement.trim().length > 0;
        const { vocabulary, filePath, fileUri, text } = await loadVocabularyDocument(ontology);
        const node = findTerm(vocabulary, term);

        if (!node || !node.$cstNode) {
            return {
                isError: true,
                content: [
                    { type: 'text' as const, text: `Term "${term}" was not found in the vocabulary.` },
                ],
            };
        }

        const termText = text.slice(node.$cstNode.offset, node.$cstNode.end);
        const spec = extractSpecialization(termText);

        const deduped = Array.from(new Set([...(spec.exists ? spec.items : []), ...superTerms]));

        let updatedTermText: string;
        if (spec.exists) {
            const segment = `< ${deduped.join(', ')}`;
            updatedTermText = termText.slice(0, spec.start) + segment + termText.slice(spec.end);
        } else {
            // Insert into the term header line, not into annotations
            // Find the header keyword line (concept|aspect|relation|scalar|property)
            const headerMatch = termText.match(/^(.*?)(concept|aspect|relation|scalar|annotation property|scalar property)\s+[A-Za-z_][A-Za-z0-9_\-]*/m);
            if (headerMatch) {
                const headerStart = headerMatch.index ?? 0;
                const headerLineStart = headerStart;
                // Find end of header line: before a block '[' or at first EOL
                const newlineIdx = termText.indexOf('\n', headerLineStart);
                const blockIdx = termText.indexOf('[', headerLineStart);
                const headerLineEnd = blockIdx !== -1 && (newlineIdx === -1 || blockIdx < newlineIdx) ? blockIdx : (newlineIdx !== -1 ? newlineIdx : termText.length);
                const beforeHeader = termText.slice(0, headerLineEnd).replace(/[ \t]+$/g, '');
                const afterHeader = termText.slice(headerLineEnd);
                updatedTermText = `${beforeHeader} < ${deduped.join(', ')}${afterHeader}`;
            } else {
                // Fallback: previous behavior but avoid inserting into annotation lines
                const firstConceptIdx = termText.search(/\n/);
                const insertionPoint = firstConceptIdx !== -1 ? firstConceptIdx : termText.length;
                const before = termText.slice(0, insertionPoint).replace(/[ \t]+$/g, '');
                const after = termText.slice(insertionPoint);
                updatedTermText = `${before} < ${deduped.join(', ')}${after}`;
            }
        }

        let newContent = text.slice(0, node.$cstNode.offset) + updatedTermText + text.slice(node.$cstNode.end);

        // If an import statement was provided from the suggestion, add it if missing
        if (needsImport) {
            const trimmedImport = importStatement!.trim();
            if (!newContent.includes(trimmedImport)) {
                const eol = newContent.includes('\r\n') ? '\r\n' : '\n';
                const indent = detectIndentation(newContent);
                const lines = newContent.split(/\r?\n/);

                // Find insertion point: after opening brace and any existing imports
                let insertLineIndex = -1;
                let inOntology = false;
                for (let i = 0; i < lines.length; i++) {
                    const trimmed = lines[i].trim();
                    if (trimmed.includes('vocabulary') || trimmed.includes('description') || trimmed.includes('bundle')) {
                        inOntology = true;
                    }
                    if (inOntology && trimmed.includes('{')) {
                        insertLineIndex = i + 1;
                        let j = insertLineIndex;
                        while (j < lines.length) {
                            const nextTrimmed = lines[j].trim();
                            if (nextTrimmed.startsWith('extends') || nextTrimmed.startsWith('uses') || nextTrimmed.startsWith('includes')) {
                                insertLineIndex = j + 1;
                                j++;
                            } else if (nextTrimmed === '') {
                                j++;
                            } else {
                                break;
                            }
                        }
                        insertLineIndex = j;
                        break;
                    }
                }

                if (insertLineIndex >= 0) {
                    const formattedImport = `${indent}${trimmedImport}`;
                    lines.splice(insertLineIndex, 0, formattedImport);
                    newContent = lines.join(eol);
                }
            }
        }

        await writeFileAndNotify(filePath, fileUri, newContent);

        return {
            content: [
                { type: 'text' as const, text: `✓ Added specialization to term "${term}"` },
            ],
        };
    } catch (error) {
        return {
            isError: true,
            content: [
                { type: 'text' as const, text: `Error adding specialization: ${error instanceof Error ? error.message : String(error)}` },
            ],
        };
    }
};
