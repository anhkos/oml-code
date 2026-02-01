import { z } from 'zod';
import { AnnotationParam, loadVocabularyDocument, writeFileAndNotify, findTerm, collectImportPrefixes } from '../common.js';
import { annotationParamSchema } from '../schemas.js';
import { isAspect, isConcept, isRelationEntity, isScalar, isScalarProperty, isUnreifiedRelation } from '../../../generated/ast.js';

const paramsSchema = {
    ontology: z.string().describe('File path or file:// URI to the target vocabulary'),
    term: z.string().describe('Term to add equivalence to'),
    equivalenceType: z.enum(['entity', 'scalar', 'property']).describe('Type of equivalence'),
    superEntities: z.array(z.string()).optional().describe('Super entities (for entity equivalence)'),
    superScalar: z.string().optional().describe('Super scalar (for scalar equivalence)'),
    superProperty: z.string().optional().describe('Super property (for property equivalence)'),
    length: z.number().optional(),
    minLength: z.number().optional(),
    maxLength: z.number().optional(),
    pattern: z.string().optional(),
    language: z.string().optional(),
    minInclusive: z.string().optional(),
    minExclusive: z.string().optional(),
    maxInclusive: z.string().optional(),
    maxExclusive: z.string().optional(),
    annotations: z.array(annotationParamSchema).optional(),
};

export const addEquivalenceTool = {
    name: 'add_equivalence' as const,
    description: 'Adds an equivalence axiom to a term (entity, scalar, or property).',
    paramsSchema,
};

export const addEquivalenceMetadata = {
    id: 'add_equivalence',
    displayName: 'Add Equivalence',
    layer: 'axiom' as const,
    severity: 'high' as const,
    version: '1.0.0',
    shortDescription: 'Add an equivalence axiom to a term',
    description: 'Adds an equivalence axiom to a term (entity, scalar, or property) to express external equivalences.',
    tags: ['axiom', 'equivalence', 'vocabulary'],
    dependencies: [],
    addedDate: '2024-01-01',
};

export const addEquivalenceHandler = async (params: {
    ontology: string;
    term: string;
    equivalenceType: 'entity' | 'scalar' | 'property';
    superEntities?: string[];
    superScalar?: string;
    superProperty?: string;
    length?: number;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    language?: string;
    minInclusive?: string;
    minExclusive?: string;
    maxInclusive?: string;
    maxExclusive?: string;
    annotations?: AnnotationParam[];
}) => {
    try {
        const { ontology, term, equivalenceType, superEntities, superScalar, superProperty } = params;
        const { vocabulary, filePath, fileUri, text, eol, indent } = await loadVocabularyDocument(ontology);

        const node = findTerm(vocabulary, term);
        if (!node || !node.$cstNode) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: `Term "${term}" not found in vocabulary.` }],
            };
        }

        // Validate term type matches equivalence type
        const isEntity = isAspect(node) || isConcept(node) || isRelationEntity(node);
        const isScalarType = isScalar(node);
        const isPropertyType = isScalarProperty(node) || isUnreifiedRelation(node);

        if (equivalenceType === 'entity' && !isEntity) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: `"${term}" is not an entity type.` }],
            };
        }
        if (equivalenceType === 'scalar' && !isScalarType) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: `"${term}" is not a scalar type.` }],
            };
        }
        if (equivalenceType === 'property' && !isPropertyType) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: `"${term}" is not a property type.` }],
            };
        }

        const importPrefixes = collectImportPrefixes(text, vocabulary.prefix);
        const missing: string[] = [];

        const ensureLocalEntity = (name: string) => {
            const target = findTerm(vocabulary, name);
            if (!target) {
                missing.push(`Super entity "${name}" not found locally. Qualify it or add an import.`);
            } else if (!isAspect(target) && !isConcept(target) && !isRelationEntity(target)) {
                missing.push(`Super entity "${name}" is not an aspect, concept, or relation entity.`);
            }
        };

        const ensureLocalScalar = (name: string) => {
            const target = findTerm(vocabulary, name);
            if (!target) {
                missing.push(`Super scalar "${name}" not found locally. Qualify it or add an import.`);
            } else if (!isScalar(target)) {
                missing.push(`Super scalar "${name}" is not a scalar.`);
            }
        };

        const ensureLocalProperty = (name: string) => {
            const target = findTerm(vocabulary, name);
            if (!target) {
                missing.push(`Super property "${name}" not found locally. Qualify it or add an import.`);
            } else if (!isScalarProperty(target) && !isUnreifiedRelation(target)) {
                missing.push(`Super property "${name}" is not a property (scalar property or unreified relation).`);
            }
        };

        const ensureImported = (prefixed: string) => {
            const prefix = prefixed.split(':')[0];
            if (!importPrefixes.has(prefix)) {
                missing.push(`Prefix "${prefix}" for "${prefixed}" is not imported. Add an import first.`);
            }
        };

        if (equivalenceType === 'entity') {
            if (!superEntities || superEntities.length === 0) {
                return {
                    isError: true,
                    content: [{ type: 'text' as const, text: `superEntities is required for entity equivalence.` }],
                };
            }
            for (const se of superEntities) {
                if (se.includes(':')) {
                    ensureImported(se);
                } else {
                    ensureLocalEntity(se);
                }
            }
        } else if (equivalenceType === 'scalar') {
            if (!superScalar) {
                return {
                    isError: true,
                    content: [{ type: 'text' as const, text: `superScalar is required for scalar equivalence.` }],
                };
            }
            if (superScalar.includes(':')) {
                ensureImported(superScalar);
            } else {
                ensureLocalScalar(superScalar);
            }
        } else if (equivalenceType === 'property') {
            if (!superProperty) {
                return {
                    isError: true,
                    content: [{ type: 'text' as const, text: `superProperty is required for property equivalence.` }],
                };
            }
            if (superProperty.includes(':')) {
                ensureImported(superProperty);
            } else {
                ensureLocalProperty(superProperty);
            }
        }

        if (missing.length) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: missing.join('\n') }],
            };
        }

        const termText = text.slice(node.$cstNode.offset, node.$cstNode.end);
        let equivalenceClause = '';

        if (equivalenceType === 'entity') {
            equivalenceClause = `= ${superEntities!.join(' & ')}`;
        } else if (equivalenceType === 'scalar') {
            let constraints = '';
            const innerIndent = indent + indent;
            if (params.length !== undefined) constraints += `${innerIndent}length ${params.length}${eol}`;
            if (params.minLength !== undefined) constraints += `${innerIndent}minLength ${params.minLength}${eol}`;
            if (params.maxLength !== undefined) constraints += `${innerIndent}maxLength ${params.maxLength}${eol}`;
            if (params.pattern) constraints += `${innerIndent}pattern "${params.pattern}"${eol}`;
            if (params.language) constraints += `${innerIndent}language ${params.language}${eol}`;
            if (params.minInclusive) constraints += `${innerIndent}minInclusive ${params.minInclusive}${eol}`;
            if (params.minExclusive) constraints += `${innerIndent}minExclusive ${params.minExclusive}${eol}`;
            if (params.maxInclusive) constraints += `${innerIndent}maxInclusive ${params.maxInclusive}${eol}`;
            if (params.maxExclusive) constraints += `${innerIndent}maxExclusive ${params.maxExclusive}${eol}`;

            if (constraints) {
                equivalenceClause = `= ${superScalar} [${eol}${constraints}${indent}]`;
            } else {
                equivalenceClause = `= ${superScalar}`;
            }
        } else if (equivalenceType === 'property') {
            equivalenceClause = `= ${superProperty}`;
        }

        // Append equivalence clause to term
        const nameEnd = termText.indexOf(eol);
        const insertPoint = nameEnd !== -1 ? nameEnd : termText.length;
        const updatedTermText = termText.slice(0, insertPoint) + ` ${equivalenceClause}` + termText.slice(insertPoint);
        const newContent = text.slice(0, node.$cstNode.offset) + updatedTermText + text.slice(node.$cstNode.end);

        await writeFileAndNotify(filePath, fileUri, newContent);

        return {
            content: [{ type: 'text' as const, text: `✓ Added ${equivalenceType} equivalence to term "${term}"` }],
        };
    } catch (error) {
        return {
            isError: true,
            content: [
                {
                    type: 'text' as const,
                    text: `Error adding equivalence: ${error instanceof Error ? error.message : String(error)}`,
                },
            ],
        };
    }
};
