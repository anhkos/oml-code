import { AnnotationParam, LiteralParam, formatAnnotations, formatLiteral } from '../common.js';

export function buildKeyLines(keys: string[][] | undefined, indent: string, eol: string): string {
    if (!keys || keys.length === 0) return '';
    return keys
        .map((keyProps) => `${indent}key ${keyProps.join(', ')}`)
        .join(eol) + eol;
}

export function buildInstanceEnumeration(instances: string[] | undefined, indent: string, eol: string): string {
    if (!instances || instances.length === 0) return '';
    return `${indent}oneOf ${instances.join(', ')}${eol}`;
}

export function buildFromToLines(
    sources: string[] | undefined,
    targets: string[] | undefined,
    indent: string,
    eol: string
): string {
    let lines = '';
    if (sources && sources.length > 0) {
        lines += `${indent}from ${sources.join(', ')}${eol}`;
    }
    if (targets && targets.length > 0) {
        lines += `${indent}to ${targets.join(', ')}${eol}`;
    }
    return lines;
}

export function buildForwardReverse(forwardName: string | undefined, reverseName: string | undefined, indent: string, eol: string): string {
    let lines = '';
    if (forwardName) {
        lines += `${indent}forward ${forwardName}${eol}`;
    }
    if (reverseName) {
        lines += `${indent}reverse ${reverseName}${eol}`;
    }
    return lines;
}

export function buildRelationFlags(
    flags: {
        functional?: boolean;
        inverseFunctional?: boolean;
        symmetric?: boolean;
        asymmetric?: boolean;
        reflexive?: boolean;
        irreflexive?: boolean;
        transitive?: boolean;
    },
    indent: string,
    eol: string
): string {
    const enabled = [
        flags.functional ? 'functional' : undefined,
        flags.inverseFunctional ? 'inverse functional' : undefined,
        flags.symmetric ? 'symmetric' : undefined,
        flags.asymmetric ? 'asymmetric' : undefined,
        flags.reflexive ? 'reflexive' : undefined,
        flags.irreflexive ? 'irreflexive' : undefined,
        flags.transitive ? 'transitive' : undefined,
    ].filter(Boolean);

    if (enabled.length === 0) return '';
    return enabled.map((flag) => `${indent}${flag}`).join(eol) + eol;
}

export function buildDomains(domains: string[] | undefined, indent: string, eol: string): string {
    if (!domains || domains.length === 0) return '';
    return `${indent}domain ${domains.join(', ')}${eol}`;
}

export function buildRanges(ranges: (string | LiteralParam)[] | undefined, indent: string, eol: string): string {
    if (!ranges || ranges.length === 0) return '';
    const rendered = ranges.map((r) => (typeof r === 'string' ? r : formatLiteral(r)));
    return `${indent}range ${rendered.join(', ')}${eol}`;
}

export function buildAnnotationLines(annotations: AnnotationParam[] | undefined, indent: string, eol: string): string {
    return formatAnnotations(annotations, indent, eol);
}
