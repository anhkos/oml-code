import { z } from 'zod';
import { AnnotationParam, PropertyValueParam, collectImportPrefixes, formatAnnotations, formatLiteral, insertBeforeClosingBrace, normalizeNameCase, stripLocalPrefix, appendValidationIfSafeMode } from '../common.js';
import { annotationParamSchema, propertyValueParamSchema } from '../schemas.js';
import { loadDescriptionDocument, writeDescriptionAndNotify, findInstance, OntologyNotFoundError, WrongOntologyTypeError } from '../description-common.js';
import { resolveSymbolName, createResolutionErrorResult, type OmlSymbolType } from '../query/index.js';
import { preferencesState } from '../preferences/preferences-state.js';
import { ensureImportsHandler } from '../methodology/ensure-imports.js';

const paramsSchema = {
    ontology: z.string().describe('ABSOLUTE file path to a DESCRIPTION ontology file. Use the full path from the open file, e.g., c:/Users/.../file.oml'),
    name: z.string().describe('Instance identifier/name (e.g., "MissionCommander", "R1", "FireFighter"). This is the OML ID for the instance.'),
    types: z.array(z.string()).optional().describe('Concept/aspect types this instance conforms to. Simple or qualified names are auto-resolved; imports are added automatically. Use suggest_oml_symbols only if you need to discover names when resolution fails.'),
    propertyValues: z.array(propertyValueParamSchema).optional().describe('Property value assertions inside the instance block [...]. Includes both scalar properties (use literalValues) and relation assertions (use referencedValues). Example: [{"property": "base:description", "literalValues": [{"type": "quoted", "value": "Mission Commander"}]}, {"property": "requirement:isExpressedBy", "referencedValues": ["Operator"]}]'),
    annotations: z.array(annotationParamSchema).optional().describe('Annotations that appear BEFORE the instance declaration (e.g., @dc:title). For properties INSIDE the instance block, use propertyValues instead.'),
};

export const createConceptInstanceTool = {
    name: 'create_concept_instance' as const,
    description: `Creates a concept instance in a DESCRIPTION ontology. Use this for description modeling - creating specific individuals that are instances of concepts defined in vocabularies.

⚠️ REQUIRED WORKFLOW - FOLLOW THESE STEPS:

1. **CHECK DESCRIPTION SCHEMAS FIRST** using route_instance tool:
   - Determines which file should contain this type
   - Shows what properties are typically required
   - Validates the instance will conform to methodology rules

2. **VALIDATE REFERENCED INSTANCES**:
   - If adding relations (e.g., requirement:isExpressedBy), ensure target instances exist
   - Verify target instances are of the correct type (e.g., stakeholder, not Element)
   - Read the description file first to see available instances

3. **PROBE USER FOR MISSING REQUIRED PROPERTIES**:
   - If schemas indicate required properties (like isExpressedBy), ASK THE USER
   - Do NOT assume or make up values
   - Example: "Which stakeholder expresses this requirement? (MissionCommander, SafetyOfficer, or other?)"

IMPORTANT: This tool is for DESCRIPTION files only. Instances are specific individuals (like "FireFighter", "R1"), not type definitions.

Auto-resolves simple or qualified types and adds missing imports. If a name is ambiguous, you'll be prompted to disambiguate; use suggest_oml_symbols only as a last resort to discover names.

OML Instance Syntax:
  instance <name> : <type1>, <type2> [
      <property> <value>
      <relation> <targetInstance>
  ]

Example 1 - Stakeholder instance:
  instance FireFighter : requirement:Stakeholder, ent:Actor [
      base:description "Frontline operator fighting fires"
  ]

Call with:
- name: "FireFighter"
- types: ["requirement:Stakeholder", "ent:Actor"]
- propertyValues: [{"property": "base:description", "literalValues": [{"type": "quoted", "value": "Frontline operator fighting fires"}]}]

Example 2 - Requirement with relation assertion:
  instance R1 : requirement:Requirement [
      base:description "Real-Time Map"
      base:expression "The system shall display real-time fire and drone locations."
      requirement:isExpressedBy Operator
  ]

Call with:
- name: "R1"
- types: ["requirement:Requirement"]
- propertyValues: [
    {"property": "base:description", "literalValues": [{"type": "quoted", "value": "Real-Time Map"}]},
    {"property": "base:expression", "literalValues": [{"type": "quoted", "value": "The system shall display real-time fire and drone locations."}]},
    {"property": "requirement:isExpressedBy", "referencedValues": ["Operator"]}
  ]`,
    paramsSchema,
};

export const createConceptInstanceMetadata = {
    id: 'create_concept_instance',
    displayName: 'Create Concept Instance',
    layer: 'description' as const,
    severity: 'critical' as const,
    version: '1.0.0',
    shortDescription: 'Create an instance of a concept in a description file',
    description: 'Creates a new concept instance (individual) in a description file with property and relation assertions.',
    tags: ['instance-creation', 'description', 'ai-friendly', 'core'],
    dependencies: ['route_instance'],
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

export const createConceptInstanceHandler = async (params: {
    ontology: string;
    name: string;
    types?: string[];
    propertyValues?: PropertyValueParam[];
    annotations?: AnnotationParam[];
}) => {
    const { ontology, name, types } = params;

    try {
        const { description, filePath, fileUri, text, eol, indent } = await loadDescriptionDocument(ontology);

        if (findInstance(description, name)) {
            // Check if instance with the same name already exists - guide to update_instance
            const typesJson = types ? JSON.stringify(types) : '["Type1", "Type2"]';
            return {
                isError: true,
                content: [{
                    type: 'text' as const,
                    text: `\n` +
                        `========================================\n` +
                        `❌ STOP: Instance "${name}" already exists!\n` +
                        `========================================\n\n` +
                        `You CANNOT create it again. To ADD TYPES, you MUST use update_instance.\n\n` +
                        `🔧 CALL THIS EXACT TOOL NOW:\n\n` +
                        `  Tool: update_instance\n` +
                        `  Parameters:\n` +
                        `    ontology: "${ontology}"\n` +
                        `    instance: "${name}"\n` +
                        `    newTypes: ${typesJson}\n\n` +
                        `This will change the instance declaration to include all specified types.\n` +
                        `DO NOT use update_property_value with rdf:type - that will NOT work.\n` +
                        `========================================`
                }],
            };
        }

        // Resolve and VERIFY types - ensure they actually exist in the workspace
        const entityTypes: OmlSymbolType[] = ['concept', 'aspect', 'relation_entity'];
        const resolvedTypes: string[] = [];
        const verifiedTypes: string[] = []; // Track which types were verified
        
        if (types && types.length > 0) {
            for (const t of types) {
                const resolution = await resolveSymbolName(t, fileUri, entityTypes);
                if (!resolution.success) {
                    // Type could not be found in workspace - provide helpful message
                    // Check if it's a "not found" type error (no suggestions = not found)
                    if (!resolution.suggestions || resolution.suggestions.length === 0) {
                        return {
                            isError: true,
                            content: [{
                                type: 'text' as const,
                                text: `Type "${t}" not found in workspace.\n\n` +
                                    `The type you specified does not exist in any imported vocabulary.\n\n` +
                                    `SUGGESTIONS:\n` +
                                    `  1. Use suggest_oml_symbols(uri="${ontology}", symbolType="concept") to discover available types\n` +
                                    `  2. Check if you need to add_import for the vocabulary containing this type\n` +
                                    `  3. Verify the spelling and prefix of the type name\n\n` +
                                    `This verification ensures you're using real concepts from your ontologies, not hallucinated names.`
                            }],
                        };
                    }
                    // Has suggestions = ambiguous, use the standard resolution error
                    return createResolutionErrorResult(resolution, t, 'type');
                }
                resolvedTypes.push(stripLocalPrefix(resolution.qualifiedName!, description.prefix));
                verifiedTypes.push(`${t} → ${resolution.qualifiedName}`);
            }
        }

        // Verify properties exist as well
        // Properties can be scalar properties, annotation properties, OR relations (unreified, forward, reverse)
        const propertyTypes: OmlSymbolType[] = ['scalar_property', 'annotation_property', 'unreified_relation', 'forward_relation', 'reverse_relation'];
        const verifiedProperties: string[] = [];
        
        if (params.propertyValues && params.propertyValues.length > 0) {
            for (const pv of params.propertyValues) {
                // Skip base: properties as they're standard
                if (pv.property.startsWith('base:') || pv.property.startsWith('dc:') || pv.property.startsWith('xsd:')) {
                    continue;
                }
                const resolution = await resolveSymbolName(pv.property, fileUri, propertyTypes);
                if (!resolution.success && (!resolution.suggestions || resolution.suggestions.length === 0)) {
                    return {
                        isError: true,
                        content: [{
                            type: 'text' as const,
                            text: `❌ Property "${pv.property}" not found in workspace.\n\n` +
                                `The property you specified does not exist in any imported vocabulary.\n\n` +
                                `💡 SUGGESTIONS:\n` +
                                `  1. Use suggest_oml_symbols(uri="${ontology}", symbolType="scalar_property") to discover scalar properties\n` +
                                `  2. Use suggest_oml_symbols(uri="${ontology}", symbolType="unreified_relation") to discover relations (including reverse relations)\n` +
                                `  3. Check if you need to add_import for the vocabulary containing this property/relation\n` +
                                `  4. Verify the spelling and prefix of the name\n\n` +
                                `This verification ensures you're using real properties from your ontologies.`
                        }],
                    };
                }
                if (resolution.success) {
                    verifiedProperties.push(`${pv.property} → ${resolution.qualifiedName}`);
                }
            }
        }

        // Collect existing and referenced prefixes, make sure all are imported with case-normalized names
        const existingPrefixes = collectImportPrefixes(text, description.prefix);
        const referencedPrefixes = new Set<string>();

        const normalizedTypes = resolvedTypes.map((t) => {
            if (t.includes(':')) {
                referencedPrefixes.add(t.split(':')[0]);
            }
            const norm = normalizeNameCase(t);
            return norm;
        });

        let workingPropertyValues: PropertyValueParam[] | undefined = params.propertyValues ? [...params.propertyValues] : undefined;

        for (const pv of workingPropertyValues ?? []) {
            if (pv.property.includes(':')) {
                referencedPrefixes.add(pv.property.split(':')[0]);
            }
            if (pv.referencedValues) {
                for (const rv of pv.referencedValues) {
                    if (rv.includes(':')) {
                        referencedPrefixes.add(rv.split(':')[0]);
                    }
                }
            }
        }

        let workingAnnotations: AnnotationParam[] | undefined = params.annotations ? [...params.annotations] : undefined;

        if (workingAnnotations && workingAnnotations.length > 0) {
            const kept: AnnotationParam[] = [];
            const descValues: PropertyValueParam['literalValues'] = [];
            for (const ann of workingAnnotations) {
                if (ann.property === 'base:description' || ann.property === 'dc:description') {
                    if (ann.literalValues) {
                        descValues.push(...ann.literalValues);
                    }
                    // ignore referencedValues for description annotations
                } else {
                    kept.push(ann);
                }
                if (ann.property.includes(':')) {
                    referencedPrefixes.add(ann.property.split(':')[0]);
                }
            }
            if (descValues.length > 0) {
                const hasExistingDesc = (workingPropertyValues ?? []).some((pv) => pv.property === 'base:description');
                if (!hasExistingDesc) {
                    workingPropertyValues = [...(workingPropertyValues ?? []), { property: 'base:description', literalValues: descValues }];
                }
            }
            workingAnnotations = kept;
        }

        for (const ann of workingAnnotations ?? []) {
            if (ann.property.includes(':')) {
                referencedPrefixes.add(ann.property.split(':')[0]);
            }
        }

        const missing = [...referencedPrefixes].filter((p) => !existingPrefixes.has(p));
        
        // Auto-add missing imports instead of returning an error
        let currentText = text;
        let currentFilePath = filePath;
        let currentFileUri = fileUri;
        
        if (missing.length > 0) {
            // Automatically call ensure_imports to add the missing imports
            const ensureResult = await ensureImportsHandler({ ontology });
            
            if (ensureResult.isError) {
                // If ensure_imports fails, return its error
                return ensureResult;
            }
            
            // Reload the document to get the updated content with new imports
            const reloaded = await loadDescriptionDocument(ontology);
            currentText = reloaded.text;
            currentFilePath = reloaded.filePath;
            currentFileUri = reloaded.fileUri;
        }

        const innerIndent = indent + indent;
        const annotationsText = formatAnnotations(workingAnnotations, indent, eol);

        const typeClause = normalizedTypes.length > 0 ? ` : ${normalizedTypes.map((t) => t.normalized).join(', ')}` : '';
        const propText = buildPropertyValues(workingPropertyValues, innerIndent, eol);
        const block = propText ? ` [${eol}${propText}${indent}]` : '';

        const instanceText = `${annotationsText}${indent}instance ${name}${typeClause}${block}${eol}${eol}`;
        const newContent = insertBeforeClosingBrace(currentText, instanceText);
        await writeDescriptionAndNotify(currentFilePath, currentFileUri, newContent);

        const notes: string[] = [];
        if (missing.length > 0) {
            notes.push(`Auto-added imports for: ${missing.join(', ')}.`);
        }
        const changedTypes = normalizedTypes.filter((t) => t.changed).map((t) => t.normalized);
        if (changedTypes.length) {
            notes.push(`Normalized type names: ${changedTypes.join(', ')}.`);
        }

        const result = {
            content: [
                { type: 'text' as const, text: `✓ Created concept instance "${name}"` },
                ...(notes.length ? [{ type: 'text' as const, text: notes.join(' ') }] : []),
                ...(verifiedTypes.length ? [{ type: 'text' as const, text: `✓ Verified types: ${verifiedTypes.join(', ')}` }] : []),
            ],
        };

        // Run validation if safe mode is enabled
        const safeMode = preferencesState.getPreferences().safeMode ?? false;
        return appendValidationIfSafeMode(result, fileUri, safeMode);
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
                        `  2. Then add_import to include the vocabularies defining your concepts\n` +
                        `  3. Then call create_concept_instance again\n\n` +
                        `Example:\n` +
                        `  create_ontology(filePath="${error.filePath}", kind="description", namespace="...", prefix="...")\n` +
                        `  add_import(ontology="${error.filePath}", targetOntologyPath="path/to/vocabulary.oml")\n` +
                        `  create_concept_instance(ontology="${error.filePath}", name="${name}", types=[...])`
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
                        `💡 SUGGESTIONS:\n` +
                        `  - Create a new description file for your instances\n` +
                        `  - Use create_ontology with kind="description"\n` +
                        `  - Vocabularies define types (concepts, relations); descriptions instantiate them`
                }],
            };
        }
        
        return {
            isError: true,
            content: [{ type: 'text' as const, text: `Error creating concept instance: ${error instanceof Error ? error.message : String(error)}` }],
        };
    }
};
