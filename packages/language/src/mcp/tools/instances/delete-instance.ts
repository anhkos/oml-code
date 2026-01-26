import { z } from 'zod';
import { loadDescriptionDocument, writeDescriptionAndNotify, findInstance, OntologyNotFoundError, WrongOntologyTypeError } from '../description-common.js';
import { findSymbolReferences, formatImpactWarning } from '../common.js';

const paramsSchema = {
    ontology: z.string().describe('ABSOLUTE file path to the target description'),
    instance: z.string().describe('Name of the instance to delete'),
    force: z.boolean().optional().describe('Force deletion even if referenced elsewhere. Default: false'),
};

export const deleteInstanceTool = {
    name: 'delete_instance' as const,
    description: `Deletes an instance (concept or relation instance) from a description.

⚠️ This tool performs IMPACT ANALYSIS before deletion:
- Scans the workspace for relation instances that reference this instance
- Shows property values and other usages

Use force=true to suppress the impact warning.`,
    paramsSchema,
};

export const deleteInstanceHandler = async ({ ontology, instance, force = false }: { ontology: string; instance: string; force?: boolean }) => {
    try {
        const { description, filePath, fileUri, text, eol } = await loadDescriptionDocument(ontology);
        const node = findInstance(description, instance);

        if (!node || !node.$cstNode) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: `Instance "${instance}" was not found in the description.` }],
            };
        }

        // Perform impact analysis - look for relation instances referencing this instance
        const impact = await findSymbolReferences(instance, filePath, {
            searchSpecializations: false,
            searchInstances: true,    // Relation instances might reference this
            searchPropertyUsage: true, // Property values might reference this
        });

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

        // Build result message
        let message = `✓ Deleted instance "${instance}"`;
        
        if (!force && impact.references.length > 0) {
            message += formatImpactWarning(impact);
        } else if (impact.references.length === 0) {
            message += '\n\n✓ No external references found - safe to delete.';
        }

        return {
            content: [{ type: 'text' as const, text: message }],
        };
    } catch (error) {
        if (error instanceof OntologyNotFoundError) {
            return {
                isError: true,
                content: [{
                    type: 'text' as const,
                    text: `❌ ONTOLOGY NOT FOUND: ${error.filePath}\n\nThe description file does not exist.`
                }],
            };
        }
        if (error instanceof WrongOntologyTypeError) {
            return {
                isError: true,
                content: [{
                    type: 'text' as const,
                    text: `❌ WRONG ONTOLOGY TYPE: Expected "description" but found "${error.actualType}". Instances can only exist in description files.`
                }],
            };
        }
        return {
            isError: true,
            content: [{ type: 'text' as const, text: `Error deleting instance: ${error instanceof Error ? error.message : String(error)}` }],
        };
    }
};
