/**
 * AST-based Concept Creation
 * 
 * An alternative implementation of create_concept that works by mutating the
 * Vocabulary AST directly, then serializing the whole tree back to OML text
 * using the OML printer.
 * 
 * Advantages over the text-insertion approach:
 * - Structural correctness is guaranteed — the AST is always well-formed
 * - No fragile regex or string-offset calculations
 * - Easier to compose with other AST-level transformations
 * - Duplicate detection is a trivial AST lookup
 * 
 * Trade-offs:
 * - Round-tripping through the printer may reformat the file (comments and
 *   whitespace are not fully preserved because Langium's CST is discarded)
 * - The printer must be kept in sync with the OML grammar
 */

import { AstUtils } from 'langium';
import type { Reference, AstNode } from 'langium';
import {
    AnnotationParam,
    loadVocabularyDocument,
    writeFileAndNotify,
    findTerm,
    stripLocalPrefix,
    collectImportPrefixes,
    appendValidationIfSafeMode,
} from '../common.js';
import { preferencesState } from '../preferences/preferences-state.js';
import { resolveSymbolName, createResolutionErrorResult, type OmlSymbolType } from '../query/index.js';
import { ensureImportsHandler } from '../methodology/ensure-imports.js';
import { printVocabulary } from './oml-printer.js';
import type {
    Concept,
    Vocabulary,
    SpecializationAxiom,
    KeyAxiom,
    InstanceEnumerationAxiom,
    Annotation as OmlAnnotation,
} from '../../../generated/ast.js';

// ────────────────────────────────────────────────────────────────────────────
// AST Node Factories
// ────────────────────────────────────────────────────────────────────────────

/**
 * Create a bare Langium Reference stub that carries the textual name.
 * 
 * Because we are building AST nodes outside of a parse cycle, there is no CST
 * to resolve against. We store the reference text in `$refText` which is what
 * the printer reads, and leave `ref` undefined (unresolved).  This is safe
 * because we are only using the node for serialization, not for linking.
 */
function makeRef<T extends AstNode>(refText: string): Reference<T> {
    return {
        $refText: refText,
    } as unknown as Reference<T>;
}

/**
 * Build a SpecializationAxiom AST node.
 */
function makeSpecializationAxiom(superTermName: string, container: AstNode): SpecializationAxiom {
    const axiom: SpecializationAxiom = {
        $type: 'SpecializationAxiom',
        $container: container,
        superTerm: makeRef(superTermName),
    } as unknown as SpecializationAxiom;
    return axiom;
}

/**
 * Build a KeyAxiom AST node.
 */
function makeKeyAxiom(propertyNames: string[], container: AstNode): KeyAxiom {
    const axiom: KeyAxiom = {
        $type: 'KeyAxiom',
        $container: container,
        properties: propertyNames.map(name => makeRef(name)),
    } as unknown as KeyAxiom;
    return axiom;
}

/**
 * Build an InstanceEnumerationAxiom AST node.
 */
function makeInstanceEnumeration(instanceNames: string[], container: AstNode): InstanceEnumerationAxiom {
    return {
        $type: 'InstanceEnumerationAxiom',
        $container: container,
        instances: instanceNames.map(name => makeRef(name)),
    } as unknown as InstanceEnumerationAxiom;
}

/**
 * Build an Annotation AST node.
 */
function makeAnnotation(param: AnnotationParam, container: AstNode): OmlAnnotation {
    const literalValues = (param.literalValues ?? []).map(lit => {
        switch (lit.type) {
            case 'integer':
                return { $type: 'IntegerLiteral', value: Number(lit.value) } as any;
            case 'decimal':
                return { $type: 'DecimalLiteral', value: Number(lit.value) } as any;
            case 'double':
                return { $type: 'DoubleLiteral', value: Number(lit.value) } as any;
            case 'boolean':
                return { $type: 'BooleanLiteral', value: Boolean(lit.value) } as any;
            case 'quoted': {
                const ql: any = { $type: 'QuotedLiteral', value: String(lit.value) };
                if (lit.scalarType) ql.type = makeRef(lit.scalarType);
                if (lit.langTag) ql.langTag = lit.langTag;
                return ql;
            }
            default:
                return { $type: 'QuotedLiteral', value: String(lit.value) } as any;
        }
    });

    const referencedValues = (param.referencedValues ?? []).map(name => makeRef(name));

    return {
        $type: 'Annotation',
        $container: container,
        property: makeRef(param.property),
        literalValues,
        referencedValues,
    } as unknown as OmlAnnotation;
}

/**
 * Build a Concept AST node with all its children, linked to the given Vocabulary.
 */
function buildConceptNode(
    vocabulary: Vocabulary,
    name: string,
    options: {
        superTerms?: string[];
        keys?: string[][];
        instanceEnumeration?: string[];
        annotations?: AnnotationParam[];
    } = {},
): Concept {
    // Create the Concept shell
    const concept: Concept = {
        $type: 'Concept',
        $container: vocabulary,
        name,
        ownedAnnotations: [],
        ownedSpecializations: [],
        ownedKeys: [],
        ownedEquivalences: [],
        ownedPropertyRestrictions: [],
    } as unknown as Concept;

    // Annotations
    if (options.annotations?.length) {
        concept.ownedAnnotations = options.annotations.map(a => makeAnnotation(a, concept));
    }

    // Specializations
    if (options.superTerms?.length) {
        concept.ownedSpecializations = options.superTerms.map(st => makeSpecializationAxiom(st, concept));
    }

    // Keys
    if (options.keys?.length) {
        concept.ownedKeys = options.keys.map(group => makeKeyAxiom(group, concept));
    }

    // Instance enumeration
    if (options.instanceEnumeration?.length) {
        (concept as any).ownedEnumeration = makeInstanceEnumeration(options.instanceEnumeration, concept);
    }

    // Wire up internal container references
    AstUtils.linkContentToContainer(concept);

    return concept;
}


/**
 * AST-based handler for create_concept.
 * 
 * Instead of building OML text and splicing it into the file string, this
 * handler:
 *   1. Parses the vocabulary file into an AST
 *   2. Builds a Concept AST node programmatically
 *   3. Pushes it onto vocabulary.ownedStatements
 *   4. Pretty-prints the whole AST back to OML text
 *   5. Writes the result to disk & notifies the LSP
 */
export const createConceptAstHandler = async (
    { ontology, name, keys, instanceEnumeration, superTerms, annotations }: {
        ontology: string;
        name: string;
        keys?: string[][];
        instanceEnumeration?: string[];
        superTerms?: string[];
        annotations?: AnnotationParam[];
    },
) => {
    try {
        // ── Validation ──────────────────────────────────────────────────
        if (!/^[A-Z]/.test(name)) {
            return {
                isError: true,
                content: [{
                    type: 'text' as const,
                    text: `Concept name "${name}" must start with a capital letter. OML convention requires concept names to begin with an uppercase character.`,
                }],
            };
        }

        // ── Load document ───────────────────────────────────────────────
        let { vocabulary, filePath, fileUri, text, eol, indent } = await loadVocabularyDocument(ontology);

        // ── Resolve superTerms ──────────────────────────────────────────
        const resolvedSuperTerms: string[] = [];
        if (superTerms?.length) {
            const entityTypes: OmlSymbolType[] = ['concept', 'aspect', 'relation_entity'];
            for (const st of superTerms) {
                const resolution = await resolveSymbolName(st, fileUri, entityTypes);
                if (!resolution.success) {
                    return createResolutionErrorResult(resolution, st);
                }
                resolvedSuperTerms.push(resolution.qualifiedName!);
            }
        }
        const normalizedSuperTerms = resolvedSuperTerms.map(st => stripLocalPrefix(st, vocabulary.prefix));

        // ── Auto-add missing imports ────────────────────────────────────
        const allReferencedNames = [
            ...(normalizedSuperTerms ?? []),
            ...(keys?.flat() ?? []),
            ...(annotations?.map(a => a.property) ?? []),
        ];
        const referencedPrefixes = new Set<string>();
        for (const ref of allReferencedNames) {
            if (ref.includes(':')) {
                referencedPrefixes.add(ref.split(':')[0]);
            }
        }
        let existingPrefixes = collectImportPrefixes(text, vocabulary.prefix);
        const missing = [...referencedPrefixes].filter(p => !existingPrefixes.has(p));

        if (missing.length > 0) {
            const ensureResult = await ensureImportsHandler({ ontology });
            if (ensureResult.isError) return ensureResult;
            // Reload document to pick up import changes
            const reloaded = await loadVocabularyDocument(ontology);
            vocabulary = reloaded.vocabulary;
            filePath = reloaded.filePath;
            fileUri = reloaded.fileUri;
            text = reloaded.text;
            eol = reloaded.eol;
            indent = reloaded.indent;
        }

        // ── Duplicate check ─────────────────────────────────────────────
        if (findTerm(vocabulary, name)) {
            return {
                isError: true,
                content: [{
                    type: 'text' as const,
                    text: `Concept "${name}" already exists in the vocabulary.`,
                }],
            };
        }

        // ── Build AST node & mutate the tree ────────────────────────────
        const concept = buildConceptNode(vocabulary, name, {
            superTerms: normalizedSuperTerms.length > 0 ? [...new Set(normalizedSuperTerms)] : undefined,
            keys,
            instanceEnumeration,
            annotations,
        });

        vocabulary.ownedStatements.push(concept);

        // ── Serialize the entire AST back to OML ────────────────────────
        const newContent = printVocabulary(vocabulary, { eol, indent });

        // ── Write & notify ──────────────────────────────────────────────
        await writeFileAndNotify(filePath, fileUri, newContent);

        // ── Build response ──────────────────────────────────────────────
        const notes: string[] = [];
        if (missing.length > 0) {
            notes.push(`Auto-added imports for: ${missing.join(', ')}.`);
        }

        // Preview the concept snippet (just the concept, not the whole file)
        const { printConcept } = await import('./oml-printer.js');
        const conceptSnippet = printConcept(concept, { eol, indent });

        const result = {
            content: [{
                type: 'text' as const,
                text: `✓ Created concept "${name}" (AST mutation)${notes.length ? '\n' + notes.join(' ') : ''}\n\nGenerated code:\n${conceptSnippet.trim()}`,
            }],
        };

        // ── Optional validation ─────────────────────────────────────────
        const safeMode = preferencesState.getPreferences().safeMode ?? false;
        return appendValidationIfSafeMode(result, fileUri, safeMode);

    } catch (error) {
        return {
            isError: true,
            content: [{
                type: 'text' as const,
                text: `Error creating concept (AST): ${error instanceof Error ? error.message : String(error)}`,
            }],
        };
    }
};
