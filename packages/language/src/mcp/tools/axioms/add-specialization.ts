import { z } from 'zod';
import { loadVocabularyDocument, writeFileAndNotify, findTerm, detectIndentation, collectImportPrefixes, stripLocalPrefix, appendValidationIfSafeMode } from '../common.js';
import { resolveSymbolName, createResolutionErrorResult, type OmlSymbolType } from '../query/index.js';
import { preferencesState } from '../preferences/preferences-state.js';

const paramsSchema = {
    ontology: z.string().describe('File path or file:// URI to the target vocabulary'),
    term: z.string().describe('Term to specialize'),
    superTerms: z.array(z.string()).nonempty().describe('Super terms to add. Can use simple names (auto-resolved) or qualified names (prefix:Name). Use suggest_oml_symbols with symbolType="entity" to discover available terms.'),
    importStatement: z.string().optional().describe('[Optional] Import statement to add if the super term requires a new import. Use "extends <namespace> as prefix" syntax (NOT "import"). Usually not needed when using symbol resolution.'),
};

export const addSpecializationTool = {
    name: 'add_specialization' as const,
    description: `Adds super terms to a term's specialization clause.

TIP: Use suggest_oml_symbols with symbolType="entity" to find available concepts/aspects first.
Simple names (without prefix) are auto-resolved. If ambiguous, you'll be prompted to disambiguate.`,
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

export const addSpecializationHandler = async ({ ontology, term, superTerms, importStatement }: { ontology: string; term: string; superTerms: string[]; importStatement?: string }) => {
    try {
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

        // Resolve superTerms - support both simple names and qualified names
        const entityTypes: OmlSymbolType[] = ['concept', 'aspect', 'relation_entity'];
        const resolvedSuperTerms: string[] = [];
        
        for (const st of superTerms) {
            const resolution = await resolveSymbolName(st, fileUri, entityTypes);
            if (!resolution.success) {
                return createResolutionErrorResult(resolution, st, 'super term');
            }
            resolvedSuperTerms.push(stripLocalPrefix(resolution.qualifiedName!, vocabulary.prefix));
        }

        const importPrefixes = collectImportPrefixes(text, vocabulary.prefix);
        const importPrefix = needsImport ? importStatement?.match(/\bas\s+([^\s{]+)/)?.[1] : undefined;
        const missing: string[] = [];
        
        // Get the local prefix (handle both escaped and unescaped forms)
        const localPrefix = vocabulary.prefix;
        const unescapedLocalPrefix = localPrefix.startsWith('^') ? localPrefix.slice(1) : localPrefix;

        for (const st of resolvedSuperTerms) {
            if (st.includes(':')) {
                const prefix = st.split(':')[0];
                // Handle escaped prefix comparison (e.g., ^capability vs capability)
                const unescapedPrefix = prefix.startsWith('^') ? prefix.slice(1) : prefix;
                
                // Skip validation if this is a self-reference (using the local vocabulary's own prefix)
                if (unescapedPrefix === unescapedLocalPrefix) {
                    // This is a self-reference like "capability:Capability" in the capability vocabulary
                    // Check that the local term actually exists
                    const localName = st.split(':')[1];
                    const local = findTerm(vocabulary, localName);
                    if (!local) {
                        missing.push(`Super term "${st}" references local term "${localName}" which doesn't exist. Create it first.`);
                    }
                    continue;
                }
                
                if (!importPrefixes.has(prefix) && !importPrefixes.has(unescapedPrefix) && importPrefix !== prefix && importPrefix !== unescapedPrefix) {
                    missing.push(`Super term "${st}" requires an import for prefix "${prefix}". Provide importStatement or add an import first.`);
                }
            } else {
                const local = findTerm(vocabulary, st);
                if (!local) {
                    missing.push(`Super term "${st}" not found locally. Qualify it or create it first.`);
                }
            }
        }

        if (missing.length) {
            return {
                isError: true,
                content: [
                    { type: 'text' as const, text: missing.join('\n') },
                ],
            };
        }

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

        let newContent = text.slice(0, node.$cstNode.offset) + updatedTermText + text.slice(node.$cstNode.end);

        // If an import statement was provided from the suggestion, add it if missing
        if (needsImport) {
            let trimmedImport = importStatement!.trim();
            
            // Fix common LLM mistake: "import" is not valid OML, should be "extends" for vocabularies
            if (trimmedImport.startsWith('import ')) {
                trimmedImport = trimmedImport.replace(/^import\s+/, 'extends ');
            }
            
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

        const result = {
            content: [
                { type: 'text' as const, text: `✓ Added specialization to term "${term}"` },
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
