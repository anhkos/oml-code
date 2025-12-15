import { z } from 'zod';
import { loadVocabularyDocument, writeFileAndNotify, findTerm } from '../common.js';

const paramsSchema = {
    ontology: z.string().describe('File path to the target vocabulary'),
    termName: z.string().describe('Name of the term (concept or relation entity) to update keys on'),
    keys: z.array(z.array(z.string())).describe('New key property groups to replace existing ones'),
};

export const updateKeyTool = {
    name: 'update_key' as const,
    description: 'Updates key axioms on a concept or relation entity by replacing all existing keys with the new set.',
    paramsSchema,
};

export const updateKeyHandler = async (
    { ontology, termName, keys }: { ontology: string; termName: string; keys: string[][] }
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

        // Check if term has a block (between [ and ])
        const blockStart = termText.indexOf('[');
        const blockEnd = termText.lastIndexOf(']');

        if (blockStart === -1 || blockEnd === -1) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: `Term "${termName}" does not have a block to contain keys.` }],
            };
        }

        const beforeBlock = termText.slice(0, blockStart + 1);
        const afterBlock = termText.slice(blockEnd);
        const blockContent = termText.slice(blockStart + 1, blockEnd);

        // Remove existing key lines
        const lines = blockContent.split(/\r?\n/);
        const nonKeyLines = lines.filter(line => !line.trim().startsWith('key '));

        // Build new key lines
        const innerIndent = indent + indent;
        const keyLines = keys.map(keyProps => `${innerIndent}key ${keyProps.join(', ')}`);

        // Reconstruct block
        const newBlockLines = [...nonKeyLines];
        // Insert keys at the end of the block
        if (keyLines.length > 0) {
            newBlockLines.push(...keyLines.map(k => k));
        }

        const newBlockContent = newBlockLines.join(eol);
        const updatedTermText = beforeBlock + newBlockContent + afterBlock;

        const newContent = text.slice(0, term.$cstNode.offset) + updatedTermText + text.slice(term.$cstNode.end);

        await writeFileAndNotify(filePath, fileUri, newContent);

        return {
            content: [
                { type: 'text' as const, text: `✓ Updated keys on term "${termName}"` },
            ],
        };
    } catch (error) {
        return {
            isError: true,
            content: [
                { type: 'text' as const, text: `Error updating keys: ${error instanceof Error ? error.message : String(error)}` },
            ],
        };
    }
};
