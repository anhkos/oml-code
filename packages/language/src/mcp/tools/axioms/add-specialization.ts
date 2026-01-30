import { z } from 'zod';
import { loadVocabularyDocument, writeFileAndNotify, findTerm, collectImportPrefixes, stripLocalPrefix, appendValidationIfSafeMode } from '../common.js';
import { resolveSymbolName, createResolutionErrorResult, type OmlSymbolType } from '../query/index.js';
import { preferencesState } from '../preferences/preferences-state.js';
import { ensureImportsHandler } from '../methodology/ensure-imports.js';

const paramsSchema = {
    ontology: z.string().describe('File path or file:// URI to the target vocabulary'),
    term: z.string().describe('Term to specialize'),
    superTerms: z.array(z.string()).nonempty().describe('Super terms to add. Simple or qualified names are auto-resolved; imports are added automatically. Use suggest_oml_symbols only if you need to discover names when resolution fails.'),
};

export const addSpecializationTool = {
    name: 'add_specialization' as const,
    description: `Adds super terms to a term's specialization clause. Names are auto-resolved and missing imports are added. If a name is ambiguous, you'll be prompted to disambiguate; use suggest_oml_symbols only as a last resort to discover available terms.`,
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

export const addSpecializationHandler = async ({ ontology, term, superTerms }: { ontology: string; term: string; superTerms: string[] }) => {
    try {
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

        // Resolve superTerms - support both simple names and qualified names
        const entityTypes: OmlSymbolType[] = ['concept', 'aspect', 'relation_entity'];
        const resolvedSuperTerms: string[] = [];
        const allQualifiedNames: string[] = []; // Track original qualified names for import detection
        
        for (const st of superTerms) {
            const resolution = await resolveSymbolName(st, fileUri, entityTypes);
            if (!resolution.success) {
                return createResolutionErrorResult(resolution, st, 'super term');
            }
            const qualified = resolution.qualifiedName!;
            allQualifiedNames.push(qualified);
            resolvedSuperTerms.push(stripLocalPrefix(qualified, vocabulary.prefix));
        }

        // Collect all referenced prefixes from the original qualified names
        const referencedPrefixes = new Set<string>();
        const localPrefix = vocabulary.prefix;
        const unescapedLocalPrefix = localPrefix.startsWith('^') ? localPrefix.slice(1) : localPrefix;
        
        for (const st of allQualifiedNames) {
            if (st.includes(':')) {
                const prefix = st.split(':')[0];
                const unescapedPrefix = prefix.startsWith('^') ? prefix.slice(1) : prefix;
                
                // Skip if this is a self-reference
                if (unescapedPrefix !== unescapedLocalPrefix) {
                    referencedPrefixes.add(prefix);
                }
            }
        }
        
        // Check local term references
        for (const st of resolvedSuperTerms) {
            if (st.includes(':')) {
                const prefix = st.split(':')[0];
                const unescapedPrefix = prefix.startsWith('^') ? prefix.slice(1) : prefix;
                
                // Check that local references exist
                if (unescapedPrefix === unescapedLocalPrefix) {
                    const localName = st.split(':')[1];
                    const local = findTerm(vocabulary, localName);
                    if (!local) {
                        return {
                            isError: true,
                            content: [
                                { type: 'text' as const, text: `Super term "${st}" references local term "${localName}" which doesn't exist. Create it first.` },
                            ],
                        };
                    }
                }
            } else {
                const local = findTerm(vocabulary, st);
                if (!local) {
                    return {
                        isError: true,
                        content: [
                            { type: 'text' as const, text: `Super term "${st}" not found locally. Qualify it or create it first.` },
                        ],
                    };
                }
            }
        }

        // Check which prefixes are missing (for reporting purposes)
        const existingPrefixes = collectImportPrefixes(text, vocabulary.prefix);
        const missing = [...referencedPrefixes].filter(p => {
            const unescapedP = p.startsWith('^') ? p.slice(1) : p;
            return !existingPrefixes.has(p) && !existingPrefixes.has(unescapedP);
        });

        const termText = text.slice(node.$cstNode.offset, node.$cstNode.end);
        const spec = extractSpecialization(termText);

        const deduped = Array.from(new Set([...(spec.exists ? spec.items : []), ...resolvedSuperTerms]));

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

        const newContent = text.slice(0, node.$cstNode.offset) + updatedTermText + text.slice(node.$cstNode.end);

        // Write the specialization first
        await writeFileAndNotify(filePath, fileUri, newContent);

        // Now call ensureImportsHandler to add missing imports
        // It will scan the updated file text and find the new prefixes
        if (missing.length > 0) {
            const ensureResult = await ensureImportsHandler({ ontology });
            if (ensureResult.isError) {
                // Log but don't fail - the specialization was added successfully
                console.error('Warning: Failed to auto-add imports:', ensureResult.content);
            }
        }

        const notes: string[] = [];
        if (missing.length > 0) {
            notes.push(`Auto-added imports for: ${missing.join(', ')}.`);
        }

        const result = {
            content: [
                { type: 'text' as const, text: `✓ Added specialization to term "${term}"${notes.length ? '\n' + notes.join(' ') : ''}` },
            ],
        };

        // Run validation if safe mode is enabled
        const safeMode = preferencesState.getPreferences().safeMode ?? false;
        return appendValidationIfSafeMode(result, fileUri, safeMode);
    } catch (error) {
        return {
            isError: true,
            content: [
                { type: 'text' as const, text: `Error adding specialization: ${error instanceof Error ? error.message : String(error)}` },
            ],
        };
    }
};
