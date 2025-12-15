import { z } from 'zod';
import { loadVocabularyDocument, writeFileAndNotify } from '../common.js';

const KNOWN_IMPORTS: Record<string, { iri: string; kind: 'extends' | 'uses' | 'includes' }> = {
    dc: { iri: 'http://purl.org/dc/elements/1.1/', kind: 'extends' },
    xsd: { iri: 'http://www.w3.org/2001/XMLSchema#', kind: 'extends' },
    rdfs: { iri: 'http://www.w3.org/2000/01/rdf-schema#', kind: 'extends' }
};

export const ensureImportsTool = {
    name: 'ensure_imports' as const,
    description: 'Ensures required imports exist based on actually used prefixes in the file (e.g., dc, xsd, rdfs). No unused imports are added.',
    paramsSchema: {
        ontology: z.string().describe('Path to the vocabulary file to update'),
    }
};

export const ensureImportsHandler = async ({ ontology }: { ontology: string }) => {
    try {
        const { text, filePath, fileUri, eol, indent, vocabulary } = await loadVocabularyDocument(ontology);

        // Detect used prefixes anywhere in the file: annotations like @dc:title and identifiers like xsd:string or rdfs:label
        const usedPrefixes = new Set<string>();
        const anyPrefixRegex = /@?([A-Za-z][\w-]*):[A-Za-z][\w-]*/g;
        let m: RegExpExecArray | null;
        while ((m = anyPrefixRegex.exec(text)) !== null) {
            usedPrefixes.add(m[1]);
        }

        // AST-driven hints: if scalar properties reference xsd types, ensure xsd prefix
        try {
            const anyXsdUse = hasXsdUsage(vocabulary);
            if (anyXsdUse) usedPrefixes.add('xsd');
        } catch {}

        // Build missing import lines
        const missingImportLines: string[] = [];
        for (const prefix of usedPrefixes) {
            const info = KNOWN_IMPORTS[prefix];
            if (!info) continue;
            const pattern = new RegExp(`\n\s*(extends|includes|uses)\s*<${escapeRegex(info.iri)}>\s*as\s*${escapeRegex(prefix)}\s*`, 'i');
            if (!pattern.test(text)) {
                missingImportLines.push(`${indent}${info.kind} <${info.iri}> as ${prefix}`);
            }
        }

        if (missingImportLines.length === 0) {
            return { content: [{ type: 'text' as const, text: '✓ Imports already satisfied' }] };
        }

        // Insert missing imports just inside the vocabulary block, after the opening brace
        const insertPos = findInsertPositionAfterOpeningBrace(text);
        const before = text.slice(0, insertPos);
        const after = text.slice(insertPos);
        const newContent = before + missingImportLines.join(eol) + eol + after;

        await writeFileAndNotify(filePath, fileUri, newContent);

        return {
            content: [{ type: 'text' as const, text: `✓ Added imports: ${missingImportLines.join(', ')}` }]
        };
    } catch (error) {
        return {
            isError: true,
            content: [{ type: 'text' as const, text: `Error ensuring imports: ${error instanceof Error ? error.message : String(error)}` }]
        };
    }
};

function hasXsdUsage(vocab: any): boolean {
    try {
        const terms = (vocab.ownedTerms || []) as any[];
        for (const t of terms) {
            if (t.$type === 'ScalarProperty' && t.scalarType) {
                const name = t.scalarType?.$refText || '';
                if (/^xsd:/i.test(name)) return true;
            }
        }
    } catch {}
    return false;
}

function findInsertPositionAfterOpeningBrace(text: string): number {
    // Find first '{' of the vocabulary and insert after the newline
    const braceIndex = text.indexOf('{');
    if (braceIndex < 0) return 0;
    const nextNewline = text.indexOf('\n', braceIndex);
    return nextNewline >= 0 ? nextNewline + 1 : braceIndex + 1;
}

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
