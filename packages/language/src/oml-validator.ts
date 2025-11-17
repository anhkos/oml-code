import type { ValidationAcceptor, ValidationChecks } from 'langium';
import type { OmlAstType, Concept, Aspect, RelationEntity, Scalar, Element, Ontology, Import } from './generated/ast.js';
import type { OmlServices } from './oml-module.js';

/**
 * Register custom validation checks.
 */
export function registerValidationChecks(services: OmlServices) {
    const registry = services.validation.ValidationRegistry;
    const validator = services.validation.OmlValidator;
    const checks: ValidationChecks<OmlAstType> = {
        Concept: [
            validator.checkConceptStartsWithCapital,
            validator.checkEntitySpecializations
        ],
        Aspect: [validator.checkEntitySpecializations],
        RelationEntity: [validator.checkEntitySpecializations],
        Scalar: [validator.checkScalarSpecializations],
        Element: [validator.checkImportedCrossReferences],
        Ontology: [validator.checkUnusedImports],
        Import: [validator.checkValidImports]
    };
    registry.register(checks, validator);
}

/**
 * Implementation of custom validations.
 */
export class OmlValidator {

    checkConceptStartsWithCapital(concept: Concept, accept: ValidationAcceptor): void {
        if (concept.name) {
            const firstChar = concept.name.substring(0, 1);
            if (firstChar.toUpperCase() !== firstChar) {
                accept('warning', 'Concept name should start with a capital.', { node: concept, property: 'name' });
            }
        }
    }

    checkImportedCrossReferences(element: Element, accept: ValidationAcceptor): void {
        // Skip validation for Import elements - they reference ontologies in global scope
        if ((element as any).$type === 'Import') return;
        
        // Get the containing ontology
        const ontology = this.getOntology(element);
        if (!ontology) return;
        
        // Walk all properties to find references and check IRI imports
        Object.entries(element as any).forEach(([key, value]) => {
            const visitRef = (ref: any) => {
                const refText: string | undefined = ref?.$refText;
                if (!refText || !refText.startsWith('<')) return;
                if (!this.isImportedIn(refText, ontology)) {
                    accept('error', `Could not find an ontology import for term '${refText}'`, { node: element as any, property: key });
                }
            };
            if (Array.isArray(value)) {
                value.forEach(v => visitRef(v));
            } else {
                visitRef(value);
            }
        });
    }

    checkValidImports(ownedImport: Import, accept: ValidationAcceptor): void {
        const ontology: any = (ownedImport as any).$container;
        // If unresolved, let linker/scope handle
        if (!ownedImport.imported?.ref) return;
        
        const imported = ownedImport.imported.ref as any;
        const kind = ownedImport.kind;
        const type = ontology?.$type;
        const importedType = imported?.$type;

        const err = (msg: string) => accept('error', msg, { node: ownedImport });

        if (kind === 'extends') {
            if (type === importedType) return;
            return err(`${type}s can extend other ${type}s (extending ${importedType})`);
        }
        
        if (type === 'Vocabulary') {
            if (kind !== 'uses') return err('Vocabularies can extend other Vocabularies and use Descriptions');
            if (importedType !== 'Description') return err(`Vocabularies use Descriptions (using ${importedType})`);
        } else if (type === 'VocabularyBundle') {
            if (kind !== 'includes') return err('Vocabulary Bundles can extend other Vocabulary Bundles and include Vocabularies');
            if (importedType !== 'Vocabulary') return err(`Vocabulary Bundles can include Vocabularies (including ${importedType})`);
        } else if (type === 'Description') {
            if (kind !== 'uses') return err('Descriptions can extend other Descriptions and use Vocabularies');
            if (importedType !== 'Vocabulary') return err(`Descriptions can use Vocabularies (using ${importedType})`);
        } else if (type === 'DescriptionBundle') {
            if (kind === 'includes') {
                if (importedType !== 'Description') return err(`Description bundles can include Descriptions (including ${importedType})`);
            } else if (kind === 'uses') {
                if (importedType !== 'Vocabulary' && importedType !== 'VocabularyBundle') {
                    return err(`Description bundles can use Vocabularies or Vocabulary Bundles (using ${importedType})`);
                }
            } else {
                return err('Description Bundles can extend Description Bundles, includes Descriptions, and use Vocabulary and Vocabulary Bundles');
            }
        }
    }

    checkUnusedImports(ontology: Ontology, accept: ValidationAcceptor): void {
        const usedPrefixes = new Set<string>();
        const visited = new Set<any>();
        
        const walk = (node: any) => {
            if (!node || typeof node !== 'object' || visited.has(node)) return;
            visited.add(node);
            
            Object.entries(node).forEach(([key, value]) => {
                // Skip internal Langium properties to avoid circular references
                if (key.startsWith('$')) return;
                
                if (Array.isArray(value)) {
                    value.forEach(walk);
                } else if (value && typeof value === 'object') {
                    if ('ref' in value && (value as any).$refText && 
                        !(value as any).$refText.startsWith('<') && 
                        (value as any).$refText.includes(':')) {
                        const prefix = (value as any).$refText.substring(0, (value as any).$refText.indexOf(':'));
                        usedPrefixes.add(prefix);
                    }
                    walk(value);
                } else if (typeof value === 'string' && value.includes(':') && !value.startsWith('<')) {
                    const prefix = value.substring(0, value.indexOf(':'));
                    usedPrefixes.add(prefix);
                }
            });
        };
        
        walk(ontology as any);
        
        for (const ownedImport of (ontology as any).ownedImports || []) {
            if (ownedImport.prefix && !usedPrefixes.has(ownedImport.prefix)) {
                accept('warning', `Could not find a reference to prefix '${ownedImport.prefix}'`, { 
                    node: ownedImport, 
                    property: 'prefix' 
                });
            }
        }
    }

    checkEntitySpecializations(entity: Concept | Aspect | RelationEntity, accept: ValidationAcceptor): void {
        if (!entity.ownedSpecializations || entity.ownedSpecializations.length === 0) {
            return;
        }

        for (const spec of entity.ownedSpecializations) {
            if (!spec.superTerm) {
                accept('error', 'Specialization must reference a known term.', { node: entity });
                continue;
            }
            this.validateReference((spec as any).superTerm, entity, accept);
        }

        // Validate property restrictions reference known properties
        if (entity.ownedPropertyRestrictions && entity.ownedPropertyRestrictions.length > 0) {
            for (const rest of entity.ownedPropertyRestrictions) {
                if ('property' in rest && !(rest as any).property) {
                    accept('error', 'Property restriction must reference a known property.', { node: entity });
                }
            }
        }
    }

    checkScalarSpecializations(scalar: Scalar, accept: ValidationAcceptor): void {
        if (scalar.ownedSpecializations && scalar.ownedSpecializations.length > 0) {
            for (const spec of scalar.ownedSpecializations) {
                if (!(spec as any).superTerm) {
                    accept('error', 'Specialization must reference a super-term.', { node: scalar });
                    continue;
                }
                this.validateReference((spec as any).superTerm, scalar, accept);
            }
        }
    }

    private validateReference(ref: any, entity: any, accept: ValidationAcceptor): void {
        if (!ref) return;

        const refText = ref?.$refText || '';
        if (!refText) return;

        // Get the ontology container to check imports and definitions
        let ontology = entity.$container;
        while (ontology && !('ownedImports' in ontology) && !('ownedStatements' in ontology)) {
            ontology = (ontology as any).$container;
        }

        // Check for QName references (e.g., "base:Condition")
        if (refText.includes(':') && !refText.startsWith('<')) {
            const [prefix] = refText.split(':');
            const importedPrefixes = new Set<string>();
            
            if (ontology && 'ownedImports' in ontology) {
                const imports = (ontology as any).ownedImports || [];
                imports.forEach((imp: any) => {
                    if (imp.prefix) {
                        importedPrefixes.add(imp.prefix);
                    }
                });
            }

            if (!importedPrefixes.has(prefix)) {
                accept('error', `Prefix '${prefix}' is not imported. Use an import like: extends <namespace#> as ${prefix}`, {
                    node: entity,
                });
            }
        }
        // Check for IRI references (e.g., "<https://example.org/base#Condition>")
        else if (refText.startsWith('<')) {
            const iriMatch = refText.match(/^<([^>]+)[#/][^#/>]*>$/);
            if (iriMatch) {
                const namespace = iriMatch[1];
                const hasImport = (ontology as any)?.ownedImports?.some(
                    (imp: any) => {
                        const refNamespace = imp.imported?.ref?.namespace?.replace(/[#/]$/, '');
                        const impNamespace = (imp.imported as any)?.namespace?.replace(/[#/]$/, '');
                        return (refNamespace && refNamespace === namespace) || 
                               (impNamespace && impNamespace === namespace);
                    }
                );
                
                if (!hasImport) {
                    accept('error', `IRI namespace '${namespace}' is not imported. Use: extends <${namespace}#>`, {
                        node: entity,
                    });
                }
            }
        }
        // Check for bare identifiers (e.g., "Condition")
        else if (!refText.includes(':') && !refText.startsWith('<')) {
            const container = ontology || entity.$container;
            let found = false;

            // Check local definitions in the container
            if (container && ('ownedStatements' in container || 'ownedMembers' in container)) {
                const statements = (container as any).ownedStatements || (container as any).ownedMembers || [];
                found = statements.some((m: any) => m.name === refText);
            }

            // If not found, check forward/reverse relations in all relation entities in the current ontology
            if (!found && ontology && ontology.ownedStatements) {
                for (const stmt of ontology.ownedStatements) {
                    if (stmt.$type === 'RelationEntity') {
                        if ((stmt.forwardRelation?.name && stmt.forwardRelation.name === refText) || 
                            (stmt.reverseRelation?.name && stmt.reverseRelation.name === refText)) {
                            found = true;
                            break;
                        }
                    }
                }
            }
            
            // If still not found, check forward/reverse relations in imported ontologies
            if (!found && ontology && ontology.ownedImports) {
                for (const imp of ontology.ownedImports) {
                    const importedOnt = imp.imported?.ref;
                    if (importedOnt && importedOnt.ownedStatements) {
                        for (const stmt of importedOnt.ownedStatements) {
                            if (stmt.$type === 'RelationEntity') {
                                if ((stmt.forwardRelation?.name && stmt.forwardRelation.name === refText) || 
                                    (stmt.reverseRelation?.name && stmt.reverseRelation.name === refText)) {
                                    found = true;
                                    break;
                                }
                            }
                        }
                    }
                    if (found) break;
                }
            }

            if (!found) {
                accept('error', `'${refText}' is not defined locally. Use a qualified name like 'prefix:${refText}' or full IRI like '<namespace#${refText}>'`, {
                    node: entity,
                });
            }
        }
    }

    private getOntology(element: any): Ontology | null {
        let e: any = element;
        while (e && e.$type !== 'Ontology') {
            e = e.$container;
        }
        return e as Ontology | null;
    }

    private isImportedIn(iri: string, ontology: any): boolean {
        if (!ontology) return false;
        
        let i = iri.lastIndexOf('#');
        if (i === -1) i = iri.lastIndexOf('/');
        if (i !== -1) {
            const namespace = iri.substring(1, i + 1); // drop < and keep trailing sep
            const normalizedNamespace = namespace.replace(/[#/]$/, '');
            
            // Check current ontology namespace
            const ownNs = ontology.namespace?.replace(/[#/]$/, '');
            if (ownNs === normalizedNamespace) return true;
            
            // Check imported namespaces
            const imports = ontology.ownedImports || [];
            for (const imp of imports) {
                const refNamespace = imp.imported?.ref?.namespace?.replace(/[#/]$/, '');
                if (refNamespace && refNamespace === normalizedNamespace) return true;
            }
        }
        return false;
    }
}
