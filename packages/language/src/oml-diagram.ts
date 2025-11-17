import { URI } from 'langium';
import type { LangiumSharedServices } from 'langium/lsp';
import {
    isVocabulary,
    isConcept,
    isAspect,
    isRelationEntity,
    isScalar,
    isUnreifiedRelation,
    isDescription,
    isOntology,
    isScalarProperty,
    isSpecializationAxiom,
    isEquivalenceAxiom,
    isType,
    isConceptInstance,
    isRelationInstance,
    isPropertyValueAssertion,
    isRelation,
    isNamedInstance,
} from './generated/ast.js';
import { randomInt } from 'crypto';

export type DiagramElement = {
    id: string;
    label?: string;
    startLine?: number;
    startColumn?: number;
    endLine?: number;
    endColumn?: number;
};

export type DiagramNode = DiagramElement & {
    kind: 'concept' | 'aspect' | 'relation-entity' | 'relation' | 'scalar' | 'equivalence' | 'concept-instance' | 'relation-instance';
    types?: string[];
    properties?: string[];
};

export type DiagramEdge = DiagramElement & {
    kind: 'specialization' | 'equivalence' | 'relation';
    source: string;
    target: string;
    hasMarker?: boolean;
};

export type DiagramModel = { nodes: DiagramNode[]; edges: DiagramEdge[] };

// ============================================================================
// SHARED UTILITIES
// ============================================================================

function getSourceLocation(astNode: any): { startLine: number; startColumn: number; endLine: number; endColumn: number } | undefined {
    const cstNode = astNode?.$cstNode;
    if (!cstNode) return undefined;
    
    const doc = astNode.$document;
    if (!doc?.textDocument) return undefined;
    
    const startPosition = doc.textDocument.positionAt(cstNode.offset);
    const endPosition = doc.textDocument.positionAt(cstNode.offset + cstNode.length);
    return {
        startLine: startPosition.line + 1,
        startColumn: startPosition.character,
        endLine: endPosition.line + 1,
        endColumn: endPosition.character
    };
}

// Helper to dereference Langium reference-wrappers reliably.
function deref(node: any): any {
    if (!node) return undefined;
    const wrapper = (node as any).ref;
    if (wrapper) return wrapper.ref ?? wrapper._ref ?? wrapper;
    return node;
}

// ============================================================================
// SHARED CONTEXT BUILDER
// ============================================================================

class DiagramContext {
    root: any;
    nodes: DiagramNode[] = [];
    edges: DiagramEdge[] = [];
    nsToPrefix = new Map<string, string>();
    astToDiagramElement = new Map<any, DiagramElement>();

    constructor(root: any) {
        this.root = root;

        // Build import prefix mapping
        const imports: any[] = root.ownedImports ?? [];
        for (const imp of imports) {
            if (!imp.imported || !imp.prefix) continue;
            const importedOntology = imp.imported.ref;
            if (!importedOntology) continue;
            if (imp.prefix) {
                this.nsToPrefix.set(importedOntology.namespace, imp.prefix);
            }
        }
    }

    getOntology(astNode: any): any {
        while (astNode && !isOntology(astNode)) {
            astNode = astNode.$container;
        }
        return astNode;
    }

    getQualifiedName(astNode: any): string {
        astNode = deref(astNode) ?? astNode;
        const ontology = this.getOntology(astNode);
        if (!ontology) return astNode.name;
        if (ontology === this.root) {
            return astNode.name;
        }
        const prefix = this.nsToPrefix.get(ontology.namespace);
        return prefix ? `${prefix}:${astNode.name}` : astNode.name;
    }

    addSpecialization(axiom: any) {
        if (!axiom.superTerm) return;

        const subId = this.getQualifiedName(axiom.$container);
        const superId = this.getQualifiedName(axiom.superTerm);
        if (!subId || !superId) return;

        const loc = getSourceLocation(axiom);

        this.edges.push({
            id: `[${subId}]->[${superId}]`,
            source: subId,
            target: superId,
            kind: 'specialization',
            hasMarker: true,
            ...loc
        });
        console.log('[OML Diagram] addSpecialization: loc for edge', this.edges[this.edges.length - 1]);

        // Handle other elements

        this.addElement(axiom.superTerm);
    }

    addEquivalence(axiom: any) {
        if (axiom.superTerms.length === 0) return;

        const subId = this.getQualifiedName(axiom.$container);
         if (!subId) return;

        const loc = getSourceLocation(axiom);

        if (axiom.superTerms.length === 1) {
            const superId = this.getQualifiedName(axiom.superTerms[0]);
            if (!superId) return;

            this.edges.push({
                id: `[${subId}]<->[${superId}]`,
                source: subId,
                target: superId,
                kind: 'equivalence',
                hasMarker: true,
                ...loc
            });
        } else {
            const nodeId = `[${subId}]<->[${randomInt(1000000)}]`;
            this.nodes.push({ 
                id: nodeId, 
                label: '&', 
                kind: 'equivalence', 
                ...loc 
            });

            let edgeIndex = 1;

            this.edges.push({
                id: `${nodeId}-edge${edgeIndex++}`,
                source: subId,
                target: nodeId,
                kind: 'equivalence',
                hasMarker: false,
                ...loc
            });

            for (const sr of axiom.superTerms ?? []) {
                const superId = this.getQualifiedName(sr);
                if (!superId) continue;

                this.edges.push({
                    id: `${nodeId}-edge${edgeIndex++}`,
                    source: nodeId,
                    target: superId,
                    kind: 'equivalence',
                    hasMarker: true,
                    ...loc
                });
            }
        }

        // Handle other elements

        for (const term of axiom.superTerms ?? []) {
            this.addElement(term);
        }
    }

    addUnreifiedRelation( rel: any) {
        const relKey = deref(rel) ?? rel;
        if (this.astToDiagramElement.has(relKey)) return;

        if ((rel.sources ?? []).length === 0 || (rel.targets ?? []).length === 0) return;

        const relId = this.getQualifiedName(rel);
        if (!relId) return;

        let diagramElement: DiagramEdge | DiagramNode;

        if (rel.sources.length === 1 && (rel.targets ?? []).length === 1) {
            const srcId = this.getQualifiedName(rel.sources[0]);
            const tgtId = this.getQualifiedName(rel.targets[0]);
            if (!srcId || !tgtId) return;

            this.edges.push(diagramElement = {
                id: relId,
                label: relId,
                source: srcId,
                target: tgtId,
                kind: 'relation'
            });
        } else {
            const nodeId = relId;
            this.nodes.push(diagramElement = { 
                id: nodeId, 
                label: relId, 
                kind: 'relation'
            });

            let edgeIndex = 1;

            for (const src of rel.sources ?? []) {
                const srcId = this.getQualifiedName(src);
                if (!srcId) continue;

                this.edges.push({
                    id: `${nodeId}-edge${edgeIndex++}`,
                    source: srcId,
                    target: nodeId,
                    kind: 'relation',
                    hasMarker: false
                });
            }

            for (const tgt of rel.targets ?? []) {
                const tgtId = this.getQualifiedName(tgt);
                if (!tgtId) continue;

                this.edges.push({
                    id: `${nodeId}-edge${edgeIndex++}`,
                    source: nodeId,
                    target: tgtId,
                    kind: 'relation',
                    hasMarker: true
                });
            }
        }

        if (diagramElement) {
            this.astToDiagramElement.set(relKey, diagramElement);
        }

        // Handle other elements

        for (const src of rel.sources ?? []) {
            this.addElement(src);
        }

        for (const tgt of rel.targets ?? []) {
            this.addElement(tgt);
        }
    }

    addRelationEntity(rel: any) {
        const relKey = deref(rel) ?? rel;
        if (this.astToDiagramElement.has(relKey)) return;

        if (rel.sources.length === 0 || (rel.targets ?? []).length === 0) return;

        const relId = this.getQualifiedName(rel);
        if (!relId) return;

        let diagramElement: DiagramNode;

        const nodeId = relId;
        this.nodes.push(diagramElement = { 
            id: nodeId, 
            label: relId, 
            kind: 'relation-entity'
        });

        let edgeIndex = 1;

        for (const src of rel.sources ?? []) {
            const srcId = this.getQualifiedName(src);
            if (!srcId) continue;

            this.edges.push({
                id: `${nodeId}-edge${edgeIndex++}`,
                source: srcId,
                target: nodeId,
                kind: 'relation',
                hasMarker: false
            });
        }

        for (const tgt of rel.targets ?? []) {
            const tgtId = this.getQualifiedName(tgt);
            if (!tgtId) continue;

            this.edges.push({
                id: `${nodeId}-edge${edgeIndex++}`,
                source: nodeId,
                target: tgtId,
                kind: 'relation',
                hasMarker: true
            });
        }

        if (diagramElement) {
            this.astToDiagramElement.set(relKey, diagramElement);
        }

        // Handle other elements

        for (const src of rel.sources ?? []) {
            this.addElement(src);
        }

        for (const tgt of rel.targets ?? []) {
            this.addElement(tgt);
        }

    }

    addType(type: any, kind: DiagramNode['kind']) {
        const typeKey = deref(type) ?? type;
        if (this.astToDiagramElement.has(typeKey)) return;

        const typeId = this.getQualifiedName(type);
        if (!typeId) return;

        let diagramElement: DiagramNode;

        const nodeId = typeId;
        this.nodes.push(diagramElement = { 
            id: nodeId, 
            label: nodeId, 
            kind: kind
        });

        if (diagramElement) {
            this.astToDiagramElement.set(typeKey, diagramElement);
        }
    }

    addScalarProperty(property: any) {
        const propertyName = this.getQualifiedName(property);
        if (!propertyName) return;
        const ranges = property.ranges ?? [];
        const rangeNames = ranges.map((r: any) => this.getQualifiedName(deref(r) ?? r));
        const label = `${propertyName}: ${rangeNames.join(', ')}`;

        for (const domain of property.domains ?? []) {
            // Ensure the domain node exists first
            this.addElement(domain);

            const subject = deref(domain) ?? domain;
            if (!subject) continue;

            const diagramElement = this.astToDiagramElement.get(subject);
            if (!diagramElement) continue;

            const node = diagramElement as DiagramNode;
            if (!node.properties) node.properties = [];
            node.properties.push(label);
        }
    }

    addConceptInstance(type: any) {
        const typeKey = deref(type) ?? type;
        if (this.astToDiagramElement.has(typeKey)) return;

        const typeId = this.getQualifiedName(type);
        if (!typeId) return;

        let diagramElement: DiagramNode;

        const nodeId = typeId;
        this.nodes.push(diagramElement = { 
            id: nodeId, 
            label: nodeId, 
            kind: 'concept-instance'
        });

        if (diagramElement) {
            this.astToDiagramElement.set(typeKey, diagramElement);
        }
    }

    addRelationValueAssertion(assertion: any) {
        if ((assertion.referencedValues ?? []).length === 0) return;

        const srcId = this.getQualifiedName(assertion.$container);
        if (!srcId) return;
        const relId = this.getQualifiedName(assertion.property);
        if (!relId) return;

        const loc = getSourceLocation(assertion);

        for(const tgt of assertion.referencedValues ?? []) {
            const tgtId = this.getQualifiedName(tgt);
            if (!tgtId) continue;

            this.edges.push({
                id: `[${srcId}]->[${tgtId}]`,
                label: relId,
                source: srcId,
                target: tgtId,
                kind: 'relation',
                hasMarker: false,
                ...loc
            });
        }

        // Handle other elements

        for (const tgt of assertion.referencedValues ?? []) {
            this.addElement(tgt);
        }
    }

    addRelationInstance(rel: any) {
        const relKey = deref(rel) ?? rel;
        if (this.astToDiagramElement.has(relKey)) return;

        if (rel.sources.length === 0 || (rel.targets ?? []).length === 0) return;

        const relId = this.getQualifiedName(rel);
        if (!relId) return;

        let diagramElement: DiagramNode;
        
        const nodeId = relId;
        this.nodes.push(diagramElement = { 
            id: nodeId, 
            label: relId, 
            kind: 'relation-instance'
        });

        let edgeIndex = 1;

        for (const src of rel.sources ?? []) {
            const srcId = this.getQualifiedName(src);
            if (!srcId) continue;

            this.edges.push({
                id: `${nodeId}-edge${edgeIndex++}`,
                source: srcId,
                target: nodeId,
                kind: 'relation',
                hasMarker: false
            });
        }

        for (const tgt of rel.targets ?? []) {
            const tgtId = this.getQualifiedName(tgt);
            if (!tgtId) continue;

            this.edges.push({
                id: `${nodeId}-edge${edgeIndex++}`,
                source: nodeId,
                target: tgtId,
                kind: 'relation',
                hasMarker: true
            });
        }

        if (diagramElement) {
            this.astToDiagramElement.set(relKey, diagramElement);
        }

        // Handle other elements

        for (const src of rel.sources ?? []) {
            this.addElement(src);
        }

        for (const tgt of rel.targets ?? []) {
            this.addElement(tgt);
        }

    }

    addScalarPropertyValueAssertion(assertion: any) {
        const container = assertion.$container;
        const subject = container?.ref?.ref ?? container?.ref?._ref ?? container;
        if (!subject) return;

        const diagramElement = this.astToDiagramElement.get(subject);
        if (!diagramElement) return;

        const propertyId = this.getQualifiedName(assertion.property);
        const values = (assertion.literalValues ?? []).map((lv: any) => {
            const value = lv.value;
            if (typeof value === 'string' && lv.$type === 'QuotedLiteral') {
                return `"${value}"`;
            }
            return String(value);
        });

        const label = `${propertyId} = ${values.join(', ')}`;
        const node = diagramElement as DiagramNode;
        if (!node.properties) node.properties = [];
        node.properties.push(label);
    }

    addElement(astNode: any) {
        astNode = astNode?.ref ?? astNode;
        if (isConcept(astNode)) {
            this.addType(astNode, 'concept');
        } else if (isAspect(astNode)) {
            this.addType(astNode, 'aspect');
        } else if (isScalar(astNode)) {
            this.addType(astNode, 'scalar');
        } else if (isRelationEntity(astNode)) {
            this.addRelationEntity(astNode);
        } else if (isUnreifiedRelation(astNode)) {
            this.addUnreifiedRelation(astNode);
        } else if (isScalarProperty(astNode)) {
            this.addScalarProperty(astNode);
        } else if (isSpecializationAxiom(astNode)) {
            this.addSpecialization(astNode);
        } else if (isEquivalenceAxiom(astNode)) {
            this.addEquivalence(astNode);
        } else if (isConceptInstance(astNode)) {
            this.addConceptInstance(astNode);
        } else if (isRelationInstance(astNode)) {
            this.addRelationInstance(astNode);
        } else if (isPropertyValueAssertion(astNode)) {
            if (isRelation(astNode.property?.ref)) {
                this.addRelationValueAssertion(astNode);
            } else if (isScalarProperty(astNode.property?.ref)) {
                this.addScalarPropertyValueAssertion(astNode);
            }
        }
    }
}


// ============================================================================
// VOCABULARY DIAGRAM BUILDER
// ============================================================================

function buildVocabularyDiagram(root: any, ctx: DiagramContext): DiagramModel {
    for (const astNode of root.ownedStatements ?? []) {
        ctx.addElement(astNode);
        if (isType(astNode)) {
            for (const s of astNode.ownedSpecializations ?? []) {
                ctx.addElement(s);
            }
            for (const e of astNode.ownedEquivalences ?? []) {
                ctx.addElement(e);
            }
        }
    }
    return { nodes: ctx.nodes, edges: ctx.edges };
}

// ============================================================================
// DESCRIPTION DIAGRAM BUILDER
// ============================================================================

function buildDescriptionDiagram(root: any, ctx: DiagramContext): DiagramModel {
    for (const astNode of root.ownedStatements ?? []) {
        ctx.addElement(astNode);
        if (isNamedInstance(astNode)) {
            for (const s of astNode.ownedPropertyValues ?? []) {
                ctx.addElement(s);
            }
        }
    }
    return { nodes: ctx.nodes, edges: ctx.edges };
}

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

export async function computeDiagramModel(shared: LangiumSharedServices, uri: string): Promise<DiagramModel> {
    const langiumDocs = shared.workspace.LangiumDocuments;
    const document = await langiumDocs.getOrCreateDocument(URI.parse(uri));
    await shared.workspace.DocumentBuilder.build([document], { validation: false });

    const root: any = document.parseResult.value;
    const ctx = new DiagramContext(root);

    if (isVocabulary(root)) {
        return buildVocabularyDiagram(root, ctx);
    } else if (isDescription(root)) {
        return buildDescriptionDiagram(root, ctx);
    }

    return { nodes: [], edges: [] };
}