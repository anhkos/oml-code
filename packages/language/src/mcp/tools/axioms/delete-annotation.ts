import { z } from 'zod';
import * as fs from 'fs';
import { NodeFileSystem } from 'langium/node';
import { createOmlServices } from '../../../oml-module.js';
import { pathToFileUri, fileUriToPath, writeFileAndNotify, getFreshDocument } from '../common.js';
import { isVocabulary, isDescription, isVocabularyBundle, isDescriptionBundle } from '../../../generated/ast.js';

const paramsSchema = {
    ontology: z.string().describe('ABSOLUTE file path to the ontology'),
    target: z.string().optional().describe('Name of the term/instance to remove annotation from. If omitted, removes from the ontology itself.'),
    property: z.string().describe('Annotation property to remove (e.g., "dc:description", "dc:title")'),
};

export const deleteAnnotationTool = {
    name: 'delete_annotation' as const,
    description: `Removes an annotation from a term, instance, or the ontology itself.

Examples:
- Remove dc:description from concept "Vehicle": target="Vehicle", property="dc:description"
- Remove dc:title from the ontology: property="dc:title" (no target)`,
    paramsSchema,
};

export const deleteAnnotationHandler = async (
    { ontology, target, property }: { ontology: string; target?: string; property: string }
) => {
    try {
        const fileUri = pathToFileUri(ontology);
        const filePath = fileUriToPath(fileUri);

        if (!fs.existsSync(filePath)) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: `Ontology not found at ${filePath}` }],
            };
        }

        const text = fs.readFileSync(filePath, 'utf-8');
        const eol = text.includes('\r\n') ? '\r\n' : '\n';

        // Escape property for regex
        const escapedProperty = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        
        // Pattern for annotation: @property value(s)
        // Can match: @dc:title "value" or @dc:description "value1", "value2"
        const annotationPattern = new RegExp(
            `^[ \\t]*@${escapedProperty}(?:\\s+[^\\n\\r]*)?(?:\\r?\\n)?`,
            'gm'
        );

        if (target) {
            // Find the target term/instance and remove annotation from it
            const services = createOmlServices(NodeFileSystem);
            const document = await getFreshDocument(services, fileUri);
            const root = document.parseResult.value;
            
            if (!isVocabulary(root) && !isDescription(root) && !isVocabularyBundle(root) && !isDescriptionBundle(root)) {
                return {
                    isError: true,
                    content: [{ type: 'text' as const, text: 'File is not a valid OML ontology' }],
                };
            }

            // Find the target element
            let targetNode: any = null;
            if ('ownedStatements' in root) {
                targetNode = root.ownedStatements.find((s: any) => s.name === target);
            }

            if (!targetNode || !targetNode.$cstNode) {
                return {
                    isError: true,
                    content: [{ type: 'text' as const, text: `Target "${target}" not found in ontology` }],
                };
            }

            // Get the text around the target to find its annotations
            const targetStart = targetNode.$cstNode.offset;
            const targetEnd = targetNode.$cstNode.end;
            const targetText = text.slice(targetStart, targetEnd);

            // Remove matching annotations from this target's text
            const updatedTargetText = targetText.replace(annotationPattern, '');
            
            if (updatedTargetText === targetText) {
                return {
                    isError: true,
                    content: [{ type: 'text' as const, text: `Annotation "@${property}" not found on "${target}"` }],
                };
            }

            const newContent = text.slice(0, targetStart) + updatedTargetText + text.slice(targetEnd);
            await writeFileAndNotify(filePath, fileUri, newContent.replace(/\r?\n{3,}/g, `${eol}${eol}`));

            return {
                content: [{ type: 'text' as const, text: `✓ Removed annotation "@${property}" from "${target}"` }],
            };
        } else {
            // Remove annotation from ontology-level (before vocabulary/description declaration)
            // Find the vocabulary/description line
            const ontologyDeclMatch = text.match(/^[ \t]*(vocabulary|description|vocabulary bundle|description bundle)\s+/m);
            if (!ontologyDeclMatch || ontologyDeclMatch.index === undefined) {
                return {
                    isError: true,
                    content: [{ type: 'text' as const, text: 'Could not find ontology declaration' }],
                };
            }

            const beforeDecl = text.slice(0, ontologyDeclMatch.index);
            const afterDecl = text.slice(ontologyDeclMatch.index);

            const updatedBefore = beforeDecl.replace(annotationPattern, '');
            
            if (updatedBefore === beforeDecl) {
                return {
                    isError: true,
                    content: [{ type: 'text' as const, text: `Annotation "@${property}" not found at ontology level` }],
                };
            }

            const newContent = (updatedBefore + afterDecl).replace(/\r?\n{3,}/g, `${eol}${eol}`);
            await writeFileAndNotify(filePath, fileUri, newContent);

            return {
                content: [{ type: 'text' as const, text: `✓ Removed ontology-level annotation "@${property}"` }],
            };
        }
    } catch (error) {
        return {
            isError: true,
            content: [
                { type: 'text' as const, text: `Error removing annotation: ${error instanceof Error ? error.message : String(error)}` },
            ],
        };
    }
};
