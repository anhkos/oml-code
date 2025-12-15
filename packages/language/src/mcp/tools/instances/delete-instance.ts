import { z } from 'zod';
import { loadDescriptionDocument, writeDescriptionAndNotify, findInstance } from '../description-common.js';

const paramsSchema = {
    ontology: z.string().describe('File path or file:// URI to the target description'),
    instance: z.string().describe('Name of the instance to delete'),
};

export const deleteInstanceTool = {
    name: 'delete_instance' as const,
    description: 'Deletes an instance (concept or relation instance) from a description.',
    paramsSchema,
};

export const deleteInstanceHandler = async ({ ontology, instance }: { ontology: string; instance: string }) => {
    try {
        const { description, filePath, fileUri, text, eol } = await loadDescriptionDocument(ontology);
        const node = findInstance(description, instance);

        if (!node || !node.$cstNode) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: `Instance "${instance}" was not found in the description.` }],
            };
        }

        const startOffset = node.$cstNode.offset;
        const endOffset = node.$cstNode.end;

        // Remove surrounding whitespace
        let adjustedStart = startOffset;
        while (adjustedStart > 0 && /[ \t]/.test(text[adjustedStart - 1])) {
            adjustedStart -= 1;
        }
        if (adjustedStart > 0 && text[adjustedStart - 1] === '\n') {
            adjustedStart -= 1;
            if (adjustedStart > 0 && text[adjustedStart - 1] === '\r') {
                adjustedStart -= 1;
            }
        }

        const newContent = (text.slice(0, adjustedStart) + text.slice(endOffset))
            .replace(/\r?\n{3,}/g, `${eol}${eol}`);

        await writeDescriptionAndNotify(filePath, fileUri, newContent);

        return {
            content: [{ type: 'text' as const, text: `✓ Deleted instance "${instance}"` }],
        };
    } catch (error) {
        return {
            isError: true,
            content: [{ type: 'text' as const, text: `Error deleting instance: ${error instanceof Error ? error.message : String(error)}` }],
        };
    }
};
