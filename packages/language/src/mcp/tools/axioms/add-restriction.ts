import { z } from 'zod';
import { loadVocabularyDocument, writeFileAndNotify, findTerm, LiteralParam, formatLiteral, collectImportPrefixes } from '../common.js';
import { literalParamSchema } from '../schemas.js';
import { isAspect, isConcept, isRelationEntity, isScalarProperty, isUnreifiedRelation } from '../../../generated/ast.js';

const paramsSchema = {
    ontology: z.string().describe('File path or file:// URI to the target vocabulary'),
    entity: z.string().describe('Entity name to restrict'),
    property: z.string().describe('Property to restrict'),
    restrictionType: z.enum(['range', 'cardinality', 'value', 'self']).describe('Type of restriction'),
    rangeKind: z.enum(['all', 'some']).optional().describe('Range restriction kind (all/some)'),
    rangeType: z.string().optional().describe('Type for range restriction'),
    cardinalityKind: z.enum(['exactly', 'min', 'max']).optional().describe('Cardinality kind'),
    cardinality: z.number().optional().describe('Cardinality value'),
    cardinalityRangeType: z.string().optional().describe('Optional type for cardinality restriction'),
    literalValue: literalParamSchema.optional().describe('Literal value for value restriction'),
    referencedValue: z.string().optional().describe('Instance reference for value restriction'),
};

export const addRestrictionTool = {
    name: 'add_restriction' as const,
    description: 'Adds a property restriction axiom to an entity (aspect, concept, or relation entity).',
    paramsSchema,
};

export const addRestrictionMetadata = {
    id: 'add_restriction',
    displayName: 'Add Restriction',
    layer: 'axiom' as const,
    severity: 'high' as const,
    version: '1.0.0',
    shortDescription: 'Add a property restriction to an entity',
    description: 'Adds a property restriction axiom to an entity to constrain property usage.',
    tags: ['axiom', 'restriction', 'property', 'vocabulary'],
    dependencies: [],
    addedDate: '2024-01-01',
};

function buildRestrictionText(params: {
    property: string;
    restrictionType: string;
    rangeKind?: string;
    rangeType?: string;
    cardinalityKind?: string;
    cardinality?: number;
    cardinalityRangeType?: string;
    literalValue?: LiteralParam;
    referencedValue?: string;
}, indent: string): string {
    const { property, restrictionType, rangeKind, rangeType, cardinalityKind, cardinality, cardinalityRangeType, literalValue, referencedValue } = params;

    switch (restrictionType) {
        case 'range':
            if (!rangeKind || !rangeType) {
                throw new Error('rangeKind and rangeType are required for range restrictions');
            }
            return `${indent}restricts ${rangeKind} ${property} to ${rangeType}`;

        case 'cardinality':
            if (!cardinalityKind || cardinality === undefined) {
                throw new Error('cardinalityKind and cardinality are required for cardinality restrictions');
            }
            const rangeClause = cardinalityRangeType ? ` ${cardinalityRangeType}` : '';
            return `${indent}restricts ${property} to ${cardinalityKind} ${cardinality}${rangeClause}`;

        case 'value':
            if (literalValue) {
                return `${indent}restricts ${property} to ${formatLiteral(literalValue)}`;
            } else if (referencedValue) {
                return `${indent}restricts ${property} to ${referencedValue}`;
            } else {
                throw new Error('literalValue or referencedValue is required for value restrictions');
            }

        case 'self':
            return `${indent}restricts ${property} to self`;

        default:
            throw new Error(`Unknown restriction type: ${restrictionType}`);
    }
}

export const addRestrictionHandler = async (params: {
    ontology: string;
    entity: string;
    property: string;
    restrictionType: 'range' | 'cardinality' | 'value' | 'self';
    rangeKind?: 'all' | 'some';
    rangeType?: string;
    cardinalityKind?: 'exactly' | 'min' | 'max';
    cardinality?: number;
    cardinalityRangeType?: string;
    literalValue?: LiteralParam;
    referencedValue?: string;
}) => {
    try {
        const { ontology, entity } = params;
        const { vocabulary, filePath, fileUri, text, eol, indent } = await loadVocabularyDocument(ontology);

        const entityNode = findTerm(vocabulary, entity);
        if (!entityNode || !entityNode.$cstNode) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: `Entity "${entity}" not found in vocabulary.` }],
            };
        }

        if (!isAspect(entityNode) && !isConcept(entityNode) && !isRelationEntity(entityNode)) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: `"${entity}" is not an entity (aspect, concept, or relation entity).` }],
            };
        }

        const importPrefixes = collectImportPrefixes(text, vocabulary.prefix);
        const missing: string[] = [];

        const ensureLocalProperty = (name: string) => {
            const propNode = findTerm(vocabulary, name);
            if (!propNode) {
                missing.push(`Property "${name}" not found locally. Qualify it or add an import.`);
            } else if (!isScalarProperty(propNode) && !isUnreifiedRelation(propNode)) {
                missing.push(`"${name}" is not a property (scalar property or unreified relation).`);
            }
        };

        const ensureLocalType = (name: string, label: string) => {
            const typeNode = findTerm(vocabulary, name);
            if (!typeNode) {
                missing.push(`${label} "${name}" not found locally. Qualify it or add an import.`);
            }
        };

        const ensureImported = (prefixed: string, label: string) => {
            const prefix = prefixed.split(':')[0];
            if (!importPrefixes.has(prefix)) {
                missing.push(`${label} "${prefixed}" requires an import for prefix "${prefix}".`);
            }
        };

        if (params.property.includes(':')) {
            ensureImported(params.property, 'Property');
        } else {
            ensureLocalProperty(params.property);
        }

        if (params.rangeType) {
            if (params.rangeType.includes(':')) {
                ensureImported(params.rangeType, 'Range type');
            } else {
                ensureLocalType(params.rangeType, 'Range type');
            }
        }

        if (params.cardinalityRangeType) {
            if (params.cardinalityRangeType.includes(':')) {
                ensureImported(params.cardinalityRangeType, 'Cardinality range type');
            } else {
                ensureLocalType(params.cardinalityRangeType, 'Cardinality range type');
            }
        }

        if (missing.length) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: missing.join('\n') }],
            };
        }

        const entityText = text.slice(entityNode.$cstNode.offset, entityNode.$cstNode.end);
        const innerIndent = indent + indent;
        const restrictionLine = buildRestrictionText(params, innerIndent);

        // Check for existing specialization block with restrictions
        const specializationMatch = entityText.match(/<[^[\]=]*\[\s*/);
        if (specializationMatch && specializationMatch.index !== undefined) {
            // Has specialization with restriction block
            const blockStart = entityText.indexOf('[', specializationMatch.index) + 1;
            const insertion = `${eol}${restrictionLine}`;
            const updatedEntityText = entityText.slice(0, blockStart) + insertion + entityText.slice(blockStart);
            const newContent = text.slice(0, entityNode.$cstNode.offset) + updatedEntityText + text.slice(entityNode.$cstNode.end);
            await writeFileAndNotify(filePath, fileUri, newContent);
            return {
                content: [{ type: 'text' as const, text: `✓ Added restriction to entity "${entity}"` }],
            };
        }

        // Check for standalone [...] block (before specialization segment)
        const blockMatch = entityText.match(/\]\s*</);
        if (blockMatch && blockMatch.index !== undefined) {
            // Has block, insert before the ]
            const blockEnd = blockMatch.index;
            const insertion = `${eol}${restrictionLine}${eol}${indent}`;
            const updatedEntityText = entityText.slice(0, blockEnd) + insertion + entityText.slice(blockEnd);
            const newContent = text.slice(0, entityNode.$cstNode.offset) + updatedEntityText + text.slice(entityNode.$cstNode.end);
            await writeFileAndNotify(filePath, fileUri, newContent);
            return {
                content: [{ type: 'text' as const, text: `✓ Added restriction to entity "${entity}"` }],
            };
        }

        // No specialization yet, check if there's already a bracketed block
        const existingBlockMatch = entityText.match(/\]\s*$/);
        if (existingBlockMatch) {
            // Has existing block, insert before ]
            const blockEnd = entityText.lastIndexOf(']');
            const insertion = `${eol}${restrictionLine}${eol}${indent}`;
            const updatedEntityText = entityText.slice(0, blockEnd) + insertion + entityText.slice(blockEnd);
            const newContent = text.slice(0, entityNode.$cstNode.offset) + updatedEntityText + text.slice(entityNode.$cstNode.end);
            await writeFileAndNotify(filePath, fileUri, newContent);
            return {
                content: [{ type: 'text' as const, text: `✓ Added restriction to entity "${entity}"` }],
            };
        }

        // No existing block or specialization, need to add < [ restrictions ]
        const nameEnd = entityText.indexOf(eol);
        const insertPoint = nameEnd !== -1 ? nameEnd : entityText.length;
        const insertion = ` < [${eol}${restrictionLine}${eol}${indent}]`;
        const updatedEntityText = entityText.slice(0, insertPoint) + insertion + entityText.slice(insertPoint);
        const newContent = text.slice(0, entityNode.$cstNode.offset) + updatedEntityText + text.slice(entityNode.$cstNode.end);
        await writeFileAndNotify(filePath, fileUri, newContent);

        return {
            content: [{ type: 'text' as const, text: `✓ Added restriction to entity "${entity}"` }],
        };
    } catch (error) {
        return {
            isError: true,
            content: [{ type: 'text' as const, text: `Error adding restriction: ${error instanceof Error ? error.message : String(error)}` }],
        };
    }
};
