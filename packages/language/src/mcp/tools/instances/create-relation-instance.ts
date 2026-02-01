import { z } from 'zod';
import { AnnotationParam, PropertyValueParam, formatAnnotations, formatLiteral, insertBeforeClosingBrace, stripLocalPrefix, collectImportPrefixes, appendValidationIfSafeMode } from '../common.js';
import { annotationParamSchema, propertyValueParamSchema } from '../schemas.js';
import { loadDescriptionDocument, writeDescriptionAndNotify, findInstance, OntologyNotFoundError, WrongOntologyTypeError } from '../description-common.js';
import { resolveSymbolName, createResolutionErrorResult, type OmlSymbolType } from '../query/index.js';
import { preferencesState } from '../preferences/preferences-state.js';
import { ensureImportsHandler } from '../methodology/ensure-imports.js';

const paramsSchema = {
    ontology: z.string().describe('ABSOLUTE file path to the target description. The file MUST exist - use create_ontology first if needed.'),
    name: z.string().describe('Relation instance name (e.g., "R1_expresses_MC")'),
    types: z.array(z.string()).optional().describe('Relation entity types this instance conforms to. Simple or qualified names are auto-resolved; imports are added automatically. Use suggest_oml_symbols only if you need to discover names when resolution fails.'),
    sources: z.array(z.string()).optional().describe('Source instances for "from" clause. Use qualified names (prefix:Name) for instances from other descriptions.'),
    targets: z.array(z.string()).optional().describe('Target instances for "to" clause. Use qualified names (prefix:Name) for instances from other descriptions.'),
    propertyValues: z.array(propertyValueParamSchema).optional().describe('Property value assertions inside the instance block'),
    annotations: z.array(annotationParamSchema).optional().describe('Annotations that appear before the instance declaration'),
};

export const createRelationInstanceTool = {
    name: 'create_relation_instance' as const,
    description: `Creates a relation instance in a description ontology linking source and target instances.

Auto-resolves simple or qualified relation types and adds missing imports. If a name is ambiguous, you'll be prompted to disambiguate; use suggest_oml_symbols only as a last resort to discover names.

Example usage to create: relation instance R1_expresses_MC : requirement:Expresses [ from R1 to MissionCommander ]

Call with:
- name: "R1_expresses_MC"
- types: ["requirement:Expresses"]
- sources: ["R1"]
- targets: ["MissionCommander"]

Note: For simple property-based relations (like requirement:expresses), use create_concept_instance with referencedValues instead.`,
    paramsSchema,
};

export const createRelationInstanceMetadata = {
    id: 'create_relation_instance',
    displayName: 'Create Relation Instance',
    layer: 'description' as const,
    severity: 'high' as const,
    version: '1.0.0',
    shortDescription: 'Create a relation instance in a description file',
    description: 'Creates a new relation instance in a description file linking source and target concept instances.',
    tags: ['instance-creation', 'relation-instance', 'description'],
    dependencies: [],
    addedDate: '2024-01-01',
};

function buildPropertyValues(propVals: PropertyValueParam[] | undefined, indent: string, eol: string): string {
    if (!propVals || propVals.length === 0) return '';
    
    const lines: string[] = [];
    for (const pv of propVals) {
        const values: string[] = [];
        if (pv.literalValues) {
            values.push(...pv.literalValues.map(formatLiteral));
        }
        if (pv.referencedValues) {
            values.push(...pv.referencedValues);
        }
        if (values.length > 0) {
            lines.push(`${indent}${pv.property} ${values.join(', ')}`);
        }
    }
    return lines.join(eol) + (lines.length > 0 ? eol : '');
}

function buildFromTo(sources: string[] | undefined, targets: string[] | undefined, indent: string, eol: string): string {
    let lines = '';
    if (sources && sources.length > 0) {
        lines += `${indent}from ${sources.join(', ')}${eol}`;
    }
    if (targets && targets.length > 0) {
        lines += `${indent}to ${targets.join(', ')}${eol}`;
    }
    return lines;
}

export const createRelationInstanceHandler = async (params: {
    ontology: string;
    name: string;
    types?: string[];
    sources?: string[];
    targets?: string[];
    propertyValues?: PropertyValueParam[];
    annotations?: AnnotationParam[];
}) => {
    const { ontology, name, types, sources, targets, propertyValues, annotations } = params;

    try {
        const { description, filePath, fileUri, text, eol, indent } = await loadDescriptionDocument(ontology);

        if (findInstance(description, name)) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: `Instance "${name}" already exists in the description.` }],
            };
        }

        // Resolve types - support both simple names and qualified names
        const entityTypes: OmlSymbolType[] = ['concept', 'aspect', 'relation_entity'];
        const resolvedTypes: string[] = [];
        
        if (types && types.length > 0) {
            for (const t of types) {
                const resolution = await resolveSymbolName(t, fileUri, entityTypes);
                if (!resolution.success) {
                    return createResolutionErrorResult(resolution, t, 'type');
                }
                resolvedTypes.push(stripLocalPrefix(resolution.qualifiedName!, description.prefix));
            }
        }

        // Collect all referenced prefixes
        const allReferencedNames = [
            ...resolvedTypes,
            ...(sources ?? []).filter(s => s.includes(':')),
            ...(targets ?? []).filter(t => t.includes(':')),
            ...(propertyValues ?? []).flatMap(pv => [
                pv.property,
                ...(pv.referencedValues ?? []).filter(rv => rv.includes(':'))
            ]),
            ...(annotations ?? []).map(a => a.property),
        ];
        const referencedPrefixes = new Set<string>();
        for (const ref of allReferencedNames) {
            if (ref.includes(':')) {
                referencedPrefixes.add(ref.split(':')[0]);
            }
        }

        // Check which prefixes are missing
        let existingPrefixes = collectImportPrefixes(text, description.prefix);
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
            const reloaded = await loadDescriptionDocument(ontology);
            currentText = reloaded.text;
            currentFilePath = reloaded.filePath;
            currentFileUri = reloaded.fileUri;
        }

        const innerIndent = indent + indent;
        const annotationsText = formatAnnotations(annotations, indent, eol);

        const typeClause = resolvedTypes.length > 0 ? ` : ${resolvedTypes.join(', ')}` : '';
        const fromToText = buildFromTo(sources, targets, innerIndent, eol);
        const propText = buildPropertyValues(propertyValues, innerIndent, eol);
        const bodyText = fromToText + propText;
        const block = bodyText ? ` [${eol}${bodyText}${indent}]` : '';

        const instanceText = `${annotationsText}${indent}relation instance ${name}${typeClause}${block}${eol}${eol}`;
        const newContent = insertBeforeClosingBrace(currentText, instanceText);
        await writeDescriptionAndNotify(currentFilePath, currentFileUri, newContent);

        const notes: string[] = [];
        if (missing.length > 0) {
            notes.push(`Auto-added imports for: ${missing.join(', ')}.`);
        }

        const result = {
            content: [{ type: 'text' as const, text: `✓ Created relation instance "${name}"${notes.length ? '\n' + notes.join(' ') : ''}` }],
        };

        // Run validation if safe mode is enabled
        const safeMode = preferencesState.getPreferences().safeMode ?? false;
        return appendValidationIfSafeMode(result, currentFileUri, safeMode);
    } catch (error) {
        // Handle specific error types with helpful guidance
        if (error instanceof OntologyNotFoundError) {
            return {
                isError: true,
                content: [{
                    type: 'text' as const,
                    text: `❌ ONTOLOGY NOT FOUND: ${error.filePath}\n\n` +
                        `The description file does not exist yet.\n\n` +
                        `🔧 ACTION REQUIRED:\n` +
                        `  1. First, create the description using create_ontology with kind="description"\n` +
                        `  2. Then add_import to include the vocabularies defining your relation types\n` +
                        `  3. Then call create_relation_instance again\n\n` +
                        `Example:\n` +
                        `  create_ontology(filePath="${error.filePath}", kind="description", namespace="...", prefix="...")\n` +
                        `  add_import(ontology="${error.filePath}", targetOntologyPath="path/to/vocabulary.oml")`
                }],
            };
        }
        
        if (error instanceof WrongOntologyTypeError) {
            return {
                isError: true,
                content: [{
                    type: 'text' as const,
                    text: `❌ WRONG ONTOLOGY TYPE: Expected "description" but found "${error.actualType}"\n\n` +
                        `Instances can only be created in DESCRIPTION files, not vocabularies.\n\n` +
                        `💡 Create a new description file for your instances using create_ontology with kind="description".`
                }],
            };
        }
        
        return {
            isError: true,
            content: [{ type: 'text' as const, text: `Error creating relation instance: ${error instanceof Error ? error.message : String(error)}` }],
        };
    }
};
