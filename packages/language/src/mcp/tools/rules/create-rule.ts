import { z } from 'zod';
import { AnnotationParam, insertBeforeClosingBrace, loadVocabularyDocument, writeFileAndNotify, formatAnnotations } from '../common.js';
import { annotationParamSchema } from '../schemas.js';

// Simple argument representation for predicates
type RuleArgument = {
    kind: 'variable' | 'literal' | 'instance';
    variable?: string;
    literal?: string;
    instance?: string;
};

// Simplified predicate representation
type RulePredicate = {
    predicateType: 'type' | 'property' | 'same_as' | 'different_from' | 'builtin';
    type?: string;
    property?: string;
    builtIn?: string;
    argument?: RuleArgument;
    argument1?: RuleArgument;
    argument2?: RuleArgument;
    arguments?: RuleArgument[];
};

const argumentSchema = z.object({
    kind: z.enum(['variable', 'literal', 'instance']),
    variable: z.string().optional(),
    literal: z.string().optional(),
    instance: z.string().optional(),
});

const predicateSchema = z.object({
    predicateType: z.enum(['type', 'property', 'same_as', 'different_from', 'builtin']),
    type: z.string().optional(),
    property: z.string().optional(),
    builtIn: z.string().optional(),
    argument: argumentSchema.optional(),
    argument1: argumentSchema.optional(),
    argument2: argumentSchema.optional(),
    arguments: z.array(argumentSchema).optional(),
});

const paramsSchema = {
    ontology: z.string().describe('File path or file:// URI to the target vocabulary'),
    name: z.string().describe('Rule name'),
    antecedents: z.array(predicateSchema).optional().describe('Antecedent predicates (rule body left side)'),
    consequents: z.array(predicateSchema).optional().describe('Consequent predicates (rule body right side)'),
    annotations: z.array(annotationParamSchema).optional(),
};

export const createRuleTool = {
    name: 'create_rule' as const,
    description: 'Creates a rule with optional antecedents and consequents.',
    paramsSchema,
};

export const createRuleMetadata = {
    id: 'create_rule',
    displayName: 'Create Rule',
    layer: 'axiom' as const,
    severity: 'high' as const,
    version: '1.0.0',
    shortDescription: 'Create a rule in a vocabulary or description file',
    description: 'Creates a new rule with antecedents and consequents for logical inference.',
    tags: ['rule-creation', 'axiom', 'logic'],
    dependencies: [],
    addedDate: '2024-01-01',
};

function formatArgument(arg: RuleArgument): string {
    switch (arg.kind) {
        case 'variable':
            return arg.variable || '?x';
        case 'literal':
            return arg.literal || '""';
        case 'instance':
            return arg.instance || 'instance';
        default:
            return '?x';
    }
}

function formatPredicate(pred: RulePredicate, indent: string): string {
    switch (pred.predicateType) {
        case 'type':
            return `${pred.type}(${formatArgument(pred.argument || { kind: 'variable', variable: '?x' })})`;
        case 'property':
            return `${pred.property}(${formatArgument(pred.argument1 || { kind: 'variable', variable: '?x' })}, ${formatArgument(pred.argument2 || { kind: 'variable', variable: '?y' })})`;
        case 'same_as':
            return `sameAs(${formatArgument(pred.argument1 || { kind: 'variable', variable: '?x' })}, ${formatArgument(pred.argument2 || { kind: 'variable', variable: '?y' })})`;
        case 'different_from':
            return `differentFrom(${formatArgument(pred.argument1 || { kind: 'variable', variable: '?x' })}, ${formatArgument(pred.argument2 || { kind: 'variable', variable: '?y' })})`;
        case 'builtin':
            const args = (pred.arguments || []).map(formatArgument).join(', ');
            return `builtIn(${pred.builtIn}, ${args})`;
        default:
            return '';
    }
}

export const createRuleHandler = async (params: {
    ontology: string;
    name: string;
    antecedents?: RulePredicate[];
    consequents?: RulePredicate[];
    annotations?: AnnotationParam[];
}) => {
    const { ontology, name, antecedents, consequents, annotations } = params;

    try {
        const { vocabulary, filePath, fileUri, text, eol, indent } = await loadVocabularyDocument(ontology);

        // Check if rule with same name exists
        const existingRule = vocabulary.ownedStatements.find(
            (stmt: any) => stmt.$type === 'Rule' && stmt.name === name
        );
        if (existingRule) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: `Rule "${name}" already exists in the vocabulary.` }],
            };
        }

        const annotationsText = formatAnnotations(annotations, indent, eol);

        let ruleText = `${annotationsText}${indent}rule ${name}`;

        // Add predicate body if provided
        if ((antecedents && antecedents.length > 0) || (consequents && consequents.length > 0)) {
            const antParts = (antecedents || []).map((p) => formatPredicate(p, indent));
            const consParts = (consequents || []).map((p) => formatPredicate(p, indent));

            const antClause = antParts.length > 0 ? antParts.join(' & ') : '';
            const consClause = consParts.length > 0 ? consParts.join(' & ') : '';

            ruleText += ` [${eol}${indent}${indent}${antClause} ${antClause && consClause ? '-> ' : ''}${consClause}${eol}${indent}]`;
        }

        ruleText += `${eol}${eol}`;

        const newContent = insertBeforeClosingBrace(text, ruleText);
        await writeFileAndNotify(filePath, fileUri, newContent);

        return {
            content: [
                { type: 'text' as const, text: `✓ Created rule "${name}"\n\nGenerated code:\n${ruleText.trim()}` },
            ],
        };
    } catch (error) {
        return {
            isError: true,
            content: [
                { type: 'text' as const, text: `Error creating rule: ${error instanceof Error ? error.message : String(error)}` },
            ],
        };
    }
};
