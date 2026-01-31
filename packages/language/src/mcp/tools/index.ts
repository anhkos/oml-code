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
import { generateVocabularyBundleHandler, generateVocabularyBundleTool } from './methodology/generate-vocabulary-bundle.js';
import { clarifyMethodologyPreferencesHandler, clarifyMethodologyPreferencesTool } from './methodology/clarify-methodology-preferences.js';
import { extractMethodologyRulesHandler, extractMethodologyRulesTool } from './methodology/extract-methodology-rules.js';
import { enforceMethodologyRulesHandler, enforceMethodologyRulesTool } from './methodology/enforce-methodology-rules.js';
import { extractDescriptionSchemasHandler, extractDescriptionSchemasTool } from './methodology/extract-description-schemas.js';
import { routeInstanceHandler, routeInstanceTool } from './methodology/route-instance.js';
import { updatePlaybookHandler, updatePlaybookTool } from './methodology/update-playbook.js';
import { listPlaybookConstraintsHandler, listPlaybookConstraintsTool } from './methodology/list-playbook-constraints.js';
import { prepareInstanceHandler, prepareInstanceTool } from './methodology/prepare-instance.js';
import { analyzeMethodologyRequestHandler, analyzeMethodologyRequestTool } from './methodology/analyze-request.js';
import { suggestOmlSymbolsTool, analyzeImpactTool, analyzeImpactHandler } from './query/index.js';
import { suggestOmlSymbolsHandler } from './query/suggest-oml-symbols.js';
import { preferencesTools } from './preferences/index.js';

const coreTools: ToolRegistration[] = [
    { tool: validateOmlTool, handler: validateOmlHandler },
    { tool: suggestOmlSymbolsTool, handler: suggestOmlSymbolsHandler },
    { tool: analyzeImpactTool, handler: analyzeImpactHandler },
    ...termTools,
    ...axiomTools,
    ...instanceTools,
    ...ontologyTools,
    ...ruleTools,
    { tool: ensureImportsTool, handler: ensureImportsHandler },
    { tool: addToBundleTool, handler: addToBundleHandler },
    { tool: smartCreateVocabularyTool, handler: smartCreateVocabularyHandler },
    { tool: generateVocabularyBundleTool, handler: generateVocabularyBundleHandler },
    { tool: clarifyMethodologyPreferencesTool, handler: clarifyMethodologyPreferencesHandler },
    { tool: extractMethodologyRulesTool, handler: extractMethodologyRulesHandler },
    { tool: enforceMethodologyRulesTool, handler: enforceMethodologyRulesHandler },
    { tool: extractDescriptionSchemasTool, handler: extractDescriptionSchemasHandler },
    { tool: routeInstanceTool, handler: routeInstanceHandler },
    { tool: updatePlaybookTool, handler: updatePlaybookHandler },
    { tool: listPlaybookConstraintsTool, handler: listPlaybookConstraintsHandler },
    { tool: prepareInstanceTool, handler: prepareInstanceHandler },
    { tool: analyzeMethodologyRequestTool, handler: analyzeMethodologyRequestHandler },
    ...preferencesTools,
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
    'create_relation',
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
    'delete_import',
    'delete_ontology',
    'add_equivalence',
    'delete_equivalence',
    'delete_restriction',
    'delete_annotation',
    'delete_key',
    'create_rule',
    'delete_rule',
    'update_rule',
    'update_term',
    'update_property_value',
    'delete_property_value',
    'delete_type_assertion',
    'update_annotation',
    'update_key',
    'update_equivalence',
    'update_restriction',
    'ensure_imports',
    'add_to_bundle',
    'smart_create_vocabulary',
    'generate_vocabulary_bundle',
    'clarify_methodology_preferences',
    'extract_methodology_rules',
    'enforce_methodology_rules',
    'extract_description_schemas',
    'route_instance',
    'update_playbook',
    'list_playbook_constraints',
    'prepare_instance',
    'analyze_methodology_request',
]);

export const allTools: ToolRegistration[] = [
    ...coreTools,
    ...pendingTools.map((p) => ({ tool: p.tool, handler: p.handler }))
];
