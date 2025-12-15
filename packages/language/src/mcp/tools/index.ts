import type { ToolRegistration } from './types.js';
import { termTools } from './terms/index.js';
import { axiomTools } from './axioms/index.js';
import { instanceTools } from './instances/index.js';
import { ontologyTools } from './ontology/index.js';
import { ruleTools } from './rules/index.js';
import { validateOmlHandler, validateOmlTool } from './validate-tool.js';
import { pendingTools } from './stubs/pending-tools.js';
import { ensureImportsHandler, ensureImportsTool } from './methodology/ensure-imports.js';
import { addToBundleHandler, addToBundleTool } from './methodology/add-to-bundle.js';
import { smartCreateVocabularyHandler, smartCreateVocabularyTool } from './methodology/smart-create-vocabulary.js';

const coreTools: ToolRegistration[] = [
    { tool: validateOmlTool, handler: validateOmlHandler },
    ...termTools,
    ...axiomTools,
    ...instanceTools,
    ...ontologyTools,
    ...ruleTools,
    { tool: ensureImportsTool, handler: ensureImportsHandler },
    { tool: addToBundleTool, handler: addToBundleHandler },
    { tool: smartCreateVocabularyTool, handler: smartCreateVocabularyHandler },
];

const coreToolsByName = new Map(coreTools.map((t) => [t.tool.name, t]));

function pickTools(names: string[]): ToolRegistration[] {
    return names.map((name) => {
        const tool = coreToolsByName.get(name);
        if (!tool) {
            throw new Error(`Tool "${name}" is not registered in coreTools`);
        }
        return tool;
    });
}

export const phase1Tools: ToolRegistration[] = pickTools([
    'validate_oml',
    'create_aspect',
    'create_concept',
    'create_relation_entity',
    'create_scalar',
    'create_scalar_property',
    'create_annotation_property',
    'create_unreified_relation',
    'delete_term',
    'add_specialization',
    'delete_specialization',
]);

export const phase2Tools: ToolRegistration[] = pickTools([
    'add_restriction',
    'create_concept_instance',
    'create_relation_instance',
    'delete_instance',
    'update_instance',
]);

export const phase3Tools: ToolRegistration[] = pickTools([
    'create_ontology',
    'add_import',
    'add_equivalence',
    'create_rule',
    'update_term',
    'update_property_value',
    'update_annotation',
    'update_key',
    'update_equivalence',
    'update_restriction',
    'ensure_imports',
    'add_to_bundle',
    'smart_create_vocabulary',
]);

export const allTools: ToolRegistration[] = [
    ...coreTools,
    ...pendingTools.map((p) => ({ tool: p.tool, handler: p.handler }))
];
