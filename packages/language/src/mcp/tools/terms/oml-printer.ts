/**
 * OML AST → Text Printer
 * 
 * Serializes a Vocabulary AST (or parts of it) back into syntactically valid OML text.
 * This is the counterpart to Langium's parser: while the parser goes text→AST,
 * this module goes AST→text.
 * 
 * Langium 4.x does not include a grammar-aware text serializer, so this is a
 * hand-written pretty-printer that mirrors the grammar rules in oml.langium.
 * 
 * Currently covers: Vocabulary, Import, Concept, Aspect, Scalar, RelationEntity,
 * ScalarProperty, AnnotationProperty, UnreifiedRelation, SpecializationAxiom,
 * KeyAxiom, InstanceEnumerationAxiom, Annotation, Literal.
 * 
 * Description / DescriptionBundle / VocabularyBundle printing can be added later.
 */

import type {
    Vocabulary,
    Import,
    Annotation as OmlAnnotation,
    Concept,
    Aspect,
    Scalar,
    RelationEntity,
    ScalarProperty,
    AnnotationProperty,
    UnreifiedRelation,
    SpecializationAxiom,
    KeyAxiom,
    InstanceEnumerationAxiom,
    LiteralEnumerationAxiom,
    Rule,
    BuiltIn,
    VocabularyStatement,
    Literal,
    QuotedLiteral,
    IntegerLiteral,
    DecimalLiteral,
    DoubleLiteral,
    BooleanLiteral,
} from '../../../generated/ast.js';
import {
    isAnnotationProperty,
    isAspect,
    isConcept,
    isRelationEntity,
    isRule,
    isBuiltIn,
    isScalar,
    isScalarProperty,
    isUnreifiedRelation,
    isQuotedLiteral,
    isIntegerLiteral,
    isDecimalLiteral,
    isDoubleLiteral,
    isBooleanLiteral,
} from '../../../generated/ast.js';

export interface PrinterOptions {
    /** End-of-line string (defaults to '\n') */
    eol?: string;
    /** Single level of indentation (defaults to '\t') */
    indent?: string;
}

const DEFAULT_OPTIONS: Required<PrinterOptions> = {
    eol: '\n',
    indent: '\t',
};

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

/**
 * Pretty-print a complete Vocabulary AST back to OML text.
 */
export function printVocabulary(vocab: Vocabulary, opts?: PrinterOptions): string {
    const o = { ...DEFAULT_OPTIONS, ...opts };
    const parts: string[] = [];

    // Owned annotations on the vocabulary itself
    for (const ann of vocab.ownedAnnotations ?? []) {
        parts.push(printAnnotation(ann, '', o));
    }

    // The AST stores namespace without <> (Langium's value converter strips them),
    // but the OML grammar requires NAMESPACE tokens to be wrapped in <>
    const ns = wrapNamespace(vocab.namespace);
    parts.push(`vocabulary ${ns} as ${vocab.prefix} {`);

    // Imports
    for (const imp of vocab.ownedImports ?? []) {
        parts.push(printImport(imp, o));
    }

    // Blank line between imports and statements (if both exist)
    if ((vocab.ownedImports?.length ?? 0) > 0 && (vocab.ownedStatements?.length ?? 0) > 0) {
        parts.push('');
    }

    // Statements
    for (let i = 0; i < (vocab.ownedStatements?.length ?? 0); i++) {
        const stmt = vocab.ownedStatements[i];
        parts.push(printStatement(stmt, o));
        // Blank line between statements
        if (i < vocab.ownedStatements.length - 1) {
            parts.push('');
        }
    }

    parts.push('}');
    return parts.join(o.eol) + o.eol;
}

/**
 * Pretty-print a single Concept AST node (standalone snippet).
 * Useful for previewing what will be inserted.
 */
export function printConcept(concept: Concept, opts?: PrinterOptions): string {
    const o = { ...DEFAULT_OPTIONS, ...opts };
    return printConceptInner(concept, o);
}

// ────────────────────────────────────────────────────────────────────────────
// Internal printers
// ────────────────────────────────────────────────────────────────────────────

function printImport(imp: Import, o: Required<PrinterOptions>): string {
    const ns = imp.imported?.$refText ?? '';
    const prefix = imp.prefix ? ` as ${imp.prefix}` : '';
    return `${o.indent}${imp.kind} ${ns}${prefix}`;
}

function printStatement(stmt: VocabularyStatement, o: Required<PrinterOptions>): string {
    if (isConcept(stmt)) return printConceptInner(stmt, o);
    if (isAspect(stmt)) return printAspectInner(stmt, o);
    if (isScalar(stmt)) return printScalarInner(stmt, o);
    if (isRelationEntity(stmt)) return printRelationEntityInner(stmt, o);
    if (isScalarProperty(stmt)) return printScalarPropertyInner(stmt, o);
    if (isAnnotationProperty(stmt)) return printAnnotationPropertyInner(stmt, o);
    if (isUnreifiedRelation(stmt)) return printUnreifiedRelationInner(stmt, o);
    if (isRule(stmt)) return printRuleInner(stmt as Rule, o);
    if (isBuiltIn(stmt)) return printBuiltInInner(stmt as BuiltIn, o);
    // Fallback for unknown statement types — return the CST source text if available
    return (stmt as any)?.$cstNode?.text ?? `${o.indent}// <unknown statement>`;
}

// ── Concept ─────────────────────────────────────────────────────────────────

function printConceptInner(c: Concept, o: Required<PrinterOptions>): string {
    const lines: string[] = [];
    const ind = o.indent;
    const ind2 = ind + ind;

    // Annotations
    for (const ann of c.ownedAnnotations ?? []) {
        lines.push(printAnnotation(ann, ind, o));
    }

    // Name or ref
    const nameOrRef = c.name ? `concept ${c.name}` : `ref concept ${c.ref?.$refText ?? '??'}`;

    // Block body (enumeration + keys)
    const hasEnum = !!c.ownedEnumeration;
    const hasKeys = (c.ownedKeys?.length ?? 0) > 0;
    const hasBlock = hasEnum || hasKeys;

    let blockText = '';
    if (hasBlock) {
        const blockLines: string[] = [];
        if (hasEnum) {
            blockLines.push(printInstanceEnumeration(c.ownedEnumeration!, ind2, o));
        }
        for (const key of c.ownedKeys ?? []) {
            blockLines.push(printKeyAxiom(key, ind2, o));
        }
        blockText = ` [${o.eol}${blockLines.join(o.eol)}${o.eol}${ind}]`;
    }

    // Specializations (< Super1, Super2)
    const specText = printSpecializations(c.ownedSpecializations, o);

    // Equivalences — not commonly used programmatically, but preserve them
    const eqText = printEntityEquivalences(c.ownedEquivalences, o);

    lines.push(`${ind}${nameOrRef}${blockText}${specText}${eqText}`);
    return lines.join(o.eol);
}

// ── Aspect ──────────────────────────────────────────────────────────────────

function printAspectInner(a: Aspect, o: Required<PrinterOptions>): string {
    const lines: string[] = [];
    const ind = o.indent;
    const ind2 = ind + ind;

    for (const ann of a.ownedAnnotations ?? []) {
        lines.push(printAnnotation(ann, ind, o));
    }

    const nameOrRef = a.name ? `aspect ${a.name}` : `ref aspect ${a.ref?.$refText ?? '??'}`;
    const hasKeys = (a.ownedKeys?.length ?? 0) > 0;
    let blockText = '';
    if (hasKeys) {
        const keyLines = (a.ownedKeys ?? []).map(k => printKeyAxiom(k, ind2, o));
        blockText = ` [${o.eol}${keyLines.join(o.eol)}${o.eol}${ind}]`;
    }
    const specText = printSpecializations(a.ownedSpecializations, o);
    const eqText = printEntityEquivalences(a.ownedEquivalences, o);

    lines.push(`${ind}${nameOrRef}${blockText}${specText}${eqText}`);
    return lines.join(o.eol);
}

// ── Scalar ──────────────────────────────────────────────────────────────────

function printScalarInner(s: Scalar, o: Required<PrinterOptions>): string {
    const lines: string[] = [];
    const ind = o.indent;

    for (const ann of s.ownedAnnotations ?? []) {
        lines.push(printAnnotation(ann, ind, o));
    }

    const nameOrRef = s.name ? `scalar ${s.name}` : `ref scalar ${s.ref?.$refText ?? '??'}`;
    const hasEnum = !!s.ownedEnumeration;
    let blockText = '';
    if (hasEnum) {
        blockText = ` [${o.eol}${printLiteralEnumeration(s.ownedEnumeration!, ind + ind, o)}${o.eol}${ind}]`;
    }
    const specText = printSpecializations(s.ownedSpecializations, o);

    lines.push(`${ind}${nameOrRef}${blockText}${specText}`);
    return lines.join(o.eol);
}

// ── RelationEntity ──────────────────────────────────────────────────────────

function printRelationEntityInner(re: RelationEntity, o: Required<PrinterOptions>): string {
    const lines: string[] = [];
    const ind = o.indent;
    const ind2 = ind + ind;

    for (const ann of re.ownedAnnotations ?? []) {
        lines.push(printAnnotation(ann, ind, o));
    }

    const nameOrRef = re.name ? `relation entity ${re.name}` : `ref relation entity ${re.ref?.$refText ?? '??'}`;

    // Block body
    const bodyLines: string[] = [];
    if (re.sources?.length) {
        bodyLines.push(`${ind2}from ${re.sources.map(r => r.$refText ?? '??').join(', ')}`);
    }
    if (re.targets?.length) {
        bodyLines.push(`${ind2}to ${re.targets.map(r => r.$refText ?? '??').join(', ')}`);
    }
    if (re.forwardRelation) {
        const fwdAnns = (re.forwardRelation.ownedAnnotations ?? []).map(a => printAnnotation(a, ind2, o));
        bodyLines.push(...fwdAnns);
        bodyLines.push(`${ind2}forward ${re.forwardRelation.name}`);
    }
    if (re.reverseRelation) {
        const revAnns = (re.reverseRelation.ownedAnnotations ?? []).map(a => printAnnotation(a, ind2, o));
        bodyLines.push(...revAnns);
        bodyLines.push(`${ind2}reverse ${re.reverseRelation.name}`);
    }
    // Flags
    const flags: string[] = [];
    if (re.functional) flags.push('functional');
    if (re.inverseFunctional) flags.push('inverse functional');
    if (re.symmetric) flags.push('symmetric');
    if (re.asymmetric) flags.push('asymmetric');
    if (re.reflexive) flags.push('reflexive');
    if (re.irreflexive) flags.push('irreflexive');
    if (re.transitive) flags.push('transitive');
    for (const f of flags) bodyLines.push(`${ind2}${f}`);
    // Keys
    for (const key of re.ownedKeys ?? []) {
        bodyLines.push(printKeyAxiom(key, ind2, o));
    }

    const hasBlock = bodyLines.length > 0;
    let blockText = '';
    if (hasBlock) {
        blockText = ` [${o.eol}${bodyLines.join(o.eol)}${o.eol}${ind}]`;
    }

    const specText = printSpecializations(re.ownedSpecializations, o);
    const eqText = printEntityEquivalences(re.ownedEquivalences, o);

    lines.push(`${ind}${nameOrRef}${blockText}${specText}${eqText}`);
    return lines.join(o.eol);
}

// ── ScalarProperty ──────────────────────────────────────────────────────────

function printScalarPropertyInner(sp: ScalarProperty, o: Required<PrinterOptions>): string {
    const lines: string[] = [];
    const ind = o.indent;
    const ind2 = ind + ind;

    for (const ann of sp.ownedAnnotations ?? []) {
        lines.push(printAnnotation(ann, ind, o));
    }

    const nameOrRef = sp.name ? `scalar property ${sp.name}` : `ref scalar property ${sp.ref?.$refText ?? '??'}`;

    const bodyLines: string[] = [];
    if (sp.domains?.length) {
        bodyLines.push(`${ind2}domain ${sp.domains.map(r => r.$refText ?? '??').join(', ')}`);
    }
    if (sp.ranges?.length) {
        bodyLines.push(`${ind2}range ${sp.ranges.map(r => r.$refText ?? '??').join(', ')}`);
    }
    if (sp.functional) bodyLines.push(`${ind2}functional`);

    const hasBlock = bodyLines.length > 0;
    let blockText = '';
    if (hasBlock) {
        blockText = ` [${o.eol}${bodyLines.join(o.eol)}${o.eol}${ind}]`;
    }

    const specText = printSpecializations(sp.ownedSpecializations, o);
    lines.push(`${ind}${nameOrRef}${blockText}${specText}`);
    return lines.join(o.eol);
}

// ── AnnotationProperty ──────────────────────────────────────────────────────

function printAnnotationPropertyInner(ap: AnnotationProperty, o: Required<PrinterOptions>): string {
    const lines: string[] = [];
    const ind = o.indent;

    for (const ann of ap.ownedAnnotations ?? []) {
        lines.push(printAnnotation(ann, ind, o));
    }

    const nameOrRef = ap.name ? `annotation property ${ap.name}` : `ref annotation property ${ap.ref?.$refText ?? '??'}`;
    const specText = printSpecializations(ap.ownedSpecializations, o);

    lines.push(`${ind}${nameOrRef}${specText}`);
    return lines.join(o.eol);
}

// ── UnreifiedRelation ───────────────────────────────────────────────────────

function printUnreifiedRelationInner(ur: UnreifiedRelation, o: Required<PrinterOptions>): string {
    const lines: string[] = [];
    const ind = o.indent;
    const ind2 = ind + ind;

    for (const ann of ur.ownedAnnotations ?? []) {
        lines.push(printAnnotation(ann, ind, o));
    }

    const nameOrRef = ur.name ? `relation ${ur.name}` : `ref relation ${ur.ref?.$refText ?? '??'}`;

    const bodyLines: string[] = [];
    if (ur.sources?.length) {
        bodyLines.push(`${ind2}from ${ur.sources.map(r => r.$refText ?? '??').join(', ')}`);
    }
    if (ur.targets?.length) {
        bodyLines.push(`${ind2}to ${ur.targets.map(r => r.$refText ?? '??').join(', ')}`);
    }
    if (ur.reverseRelation) {
        bodyLines.push(`${ind2}reverse ${ur.reverseRelation.name}`);
    }
    const flags: string[] = [];
    if (ur.functional) flags.push('functional');
    if (ur.inverseFunctional) flags.push('inverse functional');
    if (ur.symmetric) flags.push('symmetric');
    if (ur.asymmetric) flags.push('asymmetric');
    if (ur.reflexive) flags.push('reflexive');
    if (ur.irreflexive) flags.push('irreflexive');
    if (ur.transitive) flags.push('transitive');
    for (const f of flags) bodyLines.push(`${ind2}${f}`);

    const hasBlock = bodyLines.length > 0;
    let blockText = '';
    if (hasBlock) {
        blockText = ` [${o.eol}${bodyLines.join(o.eol)}${o.eol}${ind}]`;
    }

    const specText = printSpecializations(ur.ownedSpecializations, o);
    lines.push(`${ind}${nameOrRef}${blockText}${specText}`);
    return lines.join(o.eol);
}

// ── Rule ────────────────────────────────────────────────────────────────────

function printRuleInner(rule: Rule, o: Required<PrinterOptions>): string {
    // Rules have complex predicate structures; fall back to CST text if available
    if (rule.$cstNode?.text) {
        return rule.$cstNode.text.split(/\r?\n/).map(l => `${o.indent}${l.trim() ? l : ''}`).join(o.eol);
    }
    const ind = o.indent;
    const lines: string[] = [];
    for (const ann of rule.ownedAnnotations ?? []) {
        lines.push(printAnnotation(ann, ind, o));
    }
    lines.push(`${ind}rule ${rule.name ?? rule.ref?.$refText ?? '??'}`);
    return lines.join(o.eol);
}

// ── BuiltIn ─────────────────────────────────────────────────────────────────

function printBuiltInInner(bi: BuiltIn, o: Required<PrinterOptions>): string {
    const ind = o.indent;
    const lines: string[] = [];
    for (const ann of bi.ownedAnnotations ?? []) {
        lines.push(printAnnotation(ann, ind, o));
    }
    lines.push(`${ind}builtin ${bi.name ?? bi.ref?.$refText ?? '??'}`);
    return lines.join(o.eol);
}

// ── Shared helpers ──────────────────────────────────────────────────────────

function printAnnotation(ann: OmlAnnotation, indent: string, o: Required<PrinterOptions>): string {
    const prop = ann.property?.$refText ?? '??';
    const values: string[] = [];
    for (const lit of ann.literalValues ?? []) {
        values.push(printLiteral(lit));
    }
    for (const ref of ann.referencedValues ?? []) {
        values.push(ref.$refText ?? '??');
    }
    const suffix = values.length > 0 ? ' ' + values.join(', ') : '';
    return `${indent}@${prop}${suffix}`;
}

function printSpecializations(specs: SpecializationAxiom[] | undefined, _o: Required<PrinterOptions>): string {
    if (!specs || specs.length === 0) return '';
    const names = specs.map(s => s.superTerm?.$refText ?? '??');
    return ` < ${[...new Set(names)].join(', ')}`;
}

function printEntityEquivalences(eqs: any[] | undefined, _o: Required<PrinterOptions>): string {
    // EntityEquivalenceAxiom is rarely used in programmatic creation; minimal support
    if (!eqs || eqs.length === 0) return '';
    // Fall back to CST text if available
    const texts = eqs.map((eq: any) => eq?.$cstNode?.text).filter(Boolean);
    if (texts.length > 0) return ' = ' + texts.join(', ');
    return '';
}

function printKeyAxiom(key: KeyAxiom, indent: string, _o: Required<PrinterOptions>): string {
    const props = (key.properties ?? []).map(r => r.$refText ?? '??');
    return `${indent}key ${props.join(', ')}`;
}

function printInstanceEnumeration(en: InstanceEnumerationAxiom, indent: string, _o: Required<PrinterOptions>): string {
    const instances = (en.instances ?? []).map(r => r.$refText ?? '??');
    return `${indent}oneOf ${instances.join(', ')}`;
}

function printLiteralEnumeration(en: LiteralEnumerationAxiom, indent: string, _o: Required<PrinterOptions>): string {
    const lits = (en.literals ?? []).map(printLiteral);
    return `${indent}oneOf ${lits.join(', ')}`;
}

function printLiteral(lit: Literal): string {
    if (isQuotedLiteral(lit)) {
        const ql = lit as QuotedLiteral;
        const escaped = String(ql.value).replace(/"/g, '\\"');
        if (ql.type?.$refText) return `"${escaped}"^^${ql.type.$refText}`;
        if (ql.langTag) return `"${escaped}"$${ql.langTag}`;
        return `"${escaped}"`;
    }
    if (isIntegerLiteral(lit)) return String((lit as IntegerLiteral).value);
    if (isDecimalLiteral(lit)) return String((lit as DecimalLiteral).value);
    if (isDoubleLiteral(lit)) return String((lit as DoubleLiteral).value);
    if (isBooleanLiteral(lit)) return (lit as BooleanLiteral).value ? 'true' : 'false';
    return String((lit as any).value ?? '??');
}

/**
 * Wrap a namespace string in <> if not already wrapped.
 * Langium's value converter strips the angle brackets during parsing,
 * but the OML grammar requires NAMESPACE tokens to have them.
 */
function wrapNamespace(ns: string): string {
    if (ns.startsWith('<') && ns.endsWith('>')) return ns;
    return `<${ns}>`;
}
