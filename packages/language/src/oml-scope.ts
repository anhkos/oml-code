/**
 * OML Scope Provider
 * Handles cross-file reference resolution, IRI abbreviation, and qualified name scoping
 *
 * Provides enhanced scope resolution for references across imported ontologies and abbreviated IRI names.
 */

import { AstUtils, DefaultScopeProvider, EMPTY_SCOPE, stream } from 'langium';
import type { ReferenceInfo, Scope, LangiumCoreServices } from 'langium';
import type { Ontology, Import } from './generated/ast.js';
import type { LangiumDocument } from 'langium';

/**
 * OML-specific scope provider for resolving cross-document references.
 */
export class OmlScopeProvider extends DefaultScopeProvider {
  protected services: LangiumCoreServices;
  
  constructor(services: LangiumCoreServices) {
    super(services);
    this.services = services;
  }

  override getGlobalScope(referenceType: string, context: ReferenceInfo): Scope {
    // If looking for Ontology references, add all workspace ontologies
    if (referenceType === 'Ontology') {
      const langDocs = this.services.shared.workspace.LangiumDocuments;
      let result: Scope = super.getGlobalScope(referenceType, context);
      
      for (const doc of (langDocs as any).all ?? []) {
        const root = (doc as any).parseResult?.value as Ontology | undefined;
        if (root && (root as any).namespace) {
          const namespace = (root as any).namespace;
          try {
            // Add without brackets (matches stored value)
            const desc1 = this.descriptions.createDescription(root, namespace, doc as any);
            result = this.createScope(stream([desc1]), result);
            
            // Add with brackets (matches reference text)
            if (!namespace.startsWith('<')) {
              const withBrackets = `<${namespace}>`;
              const desc2 = this.descriptions.createDescription(root, withBrackets, doc as any);
              result = this.createScope(stream([desc2]), result);
            }
          } catch (e) {
            // Ignore errors during description creation
          }
        }
      }
      
      return result;
    }
    
    return super.getGlobalScope(referenceType, context);
  }

  override getScope(context: ReferenceInfo): Scope {
    let referenceType = '';

    // Determine the expected reference type
    try {
      referenceType = this.reflection.getReferenceType(context);
    } catch {
      return EMPTY_SCOPE;
    }

    // Start with the default global scope (handles local resolution)
    // For Ontology references, this now includes all workspace ontologies
    let result: Scope = this.getGlobalScope(referenceType, context);

    // Enhance with cross-document IRI abbreviations from imports
    const document = AstUtils.getDocument(context.container);
    const ontology = document?.parseResult?.value as Ontology | undefined;

    if (ontology) {
      // First, handle the current ontology's own prefix for self-references
      const currentPrefix = (ontology as any).prefix as string | undefined;
      
      if (currentPrefix) {
        const statements = (ontology as any).ownedStatements || (ontology as any).ownedMembers || [];
        
        for (const m of statements) {
          if (m && typeof m === 'object' && 'name' in m && (m as any).name) {
            const name = (m as any).name as string;
            if (!name) continue;
            
            try {
              // Add prefixed QName for self-reference (e.g., dc:creator)
              const qname = `${currentPrefix}:${name}`;
              const desc = this.descriptions.createDescription(m, qname, document);
              result = this.createScope(stream([desc]), result);
            } catch {
              // Ignore errors during description creation
            }
            
            // Also handle RelationEntity forward/reverse relations with qualified names
            if (m.$type === 'RelationEntity') {
              if ((m as any).forwardRelation?.name) {
                try {
                  const forwardName = (m as any).forwardRelation.name;
                  const qname = `${currentPrefix}:${forwardName}`;
                  const desc = this.descriptions.createDescription((m as any).forwardRelation, qname, document);
                  result = this.createScope(stream([desc]), result);
                } catch {
                  // Ignore errors
                }
              }
              if ((m as any).reverseRelation?.name) {
                try {
                  const reverseName = (m as any).reverseRelation.name;
                  const qname = `${currentPrefix}:${reverseName}`;
                  const desc = this.descriptions.createDescription((m as any).reverseRelation, qname, document);
                  result = this.createScope(stream([desc]), result);
                } catch {
                  // Ignore errors
                }
              }
            }
          }
        }
        
        // Also add unprefixed local names for forward/reverse relations so they can be referenced locally
        for (const m of statements) {
          if (m && m.$type === 'RelationEntity') {
            if ((m as any).forwardRelation?.name) {
              try {
                const forwardName = (m as any).forwardRelation.name;
                const desc = this.descriptions.createDescription((m as any).forwardRelation, forwardName, document);
                result = this.createScope(stream([desc]), result);
              } catch {
                // Ignore errors
              }
            }
            if ((m as any).reverseRelation?.name) {
              try {
                const reverseName = (m as any).reverseRelation.name;
                const desc = this.descriptions.createDescription((m as any).reverseRelation, reverseName, document);
                result = this.createScope(stream([desc]), result);
              } catch {
                // Ignore errors
              }
            }
          }
        }
      }
      
      // Also add unprefixed local names for forward/reverse relations even if no prefix is defined
      if (!currentPrefix) {
        const statements = (ontology as any).ownedStatements || (ontology as any).ownedMembers || [];
        for (const m of statements) {
          if (m && m.$type === 'RelationEntity') {
            if ((m as any).forwardRelation?.name) {
              try {
                const forwardName = (m as any).forwardRelation.name;
                const desc = this.descriptions.createDescription((m as any).forwardRelation, forwardName, document);
                result = this.createScope(stream([desc]), result);
              } catch {
                // Ignore errors
              }
            }
            if ((m as any).reverseRelation?.name) {
              try {
                const reverseName = (m as any).reverseRelation.name;
                const desc = this.descriptions.createDescription((m as any).reverseRelation, reverseName, document);
                result = this.createScope(stream([desc]), result);
              } catch {
                // Ignore errors
              }
            }
          }
        }
      }
      
      // Handle UnreifiedRelation reverse relations too
      if (currentPrefix) {
        const statements = (ontology as any).ownedStatements || (ontology as any).ownedMembers || [];
        for (const m of statements) {
          if (m && m.$type === 'UnreifiedRelation') {
            if ((m as any).reverseRelation?.name) {
              try {
                const reverseName = (m as any).reverseRelation.name;
                // Add both qualified and unqualified
                const qname = `${currentPrefix}:${reverseName}`;
                const desc1 = this.descriptions.createDescription((m as any).reverseRelation, qname, document);
                result = this.createScope(stream([desc1]), result);
                const desc2 = this.descriptions.createDescription((m as any).reverseRelation, reverseName, document);
                result = this.createScope(stream([desc2]), result);
              } catch {
                // Ignore errors
              }
            }
          }
        }
      } else {
        // No prefix - just add unqualified names
        const statements = (ontology as any).ownedStatements || (ontology as any).ownedMembers || [];
        for (const m of statements) {
          if (m && m.$type === 'UnreifiedRelation') {
            if ((m as any).reverseRelation?.name) {
              try {
                const reverseName = (m as any).reverseRelation.name;
                const desc = this.descriptions.createDescription((m as any).reverseRelation, reverseName, document);
                result = this.createScope(stream([desc]), result);
              } catch {
                // Ignore errors
              }
            }
          }
        }
      }
      
      // Then, handle imports
      if ((ontology as any).ownedImports) {
        const imports = (ontology as any).ownedImports as Import[];

        // For each import, add descriptions with abbreviated QNames
        for (const imp of imports) {
          if (!imp.imported || !imp.prefix) continue;

          const ns = (imp.imported as any)?.namespace || (imp.imported as any)?.iri || (imp.imported as any)?.$refText || '';
          const namespace = typeof ns === 'string' ? ns.replace(/^<|>$/g, '') : '';

        // Find the imported ontology document by matching namespace among loaded docs
        const langDocs = this.services.shared.workspace.LangiumDocuments;
        let importedOnto: Ontology | undefined;
        let importedDoc: LangiumDocument | undefined;
        
        for (const doc of (langDocs as any).all ?? []) {
          const root = (doc as any).parseResult?.value as Ontology | undefined;
          if (root && (root as any).namespace) {
            const rootNs = (root as any).namespace.replace(/[#/]?$/, '');
            const targetNs = namespace.replace(/[#/]?$/, '');
            if (rootNs === targetNs) {
              importedOnto = root;
              importedDoc = doc as any;
              break;
            }
          }
        }

        if (!importedOnto || !importedDoc) continue;

        // Collect exported term nodes from the imported ontology
        const members: any[] = [];
        const statements = (importedOnto as any).ownedStatements || (importedOnto as any).ownedMembers || [];
        
        for (const m of statements) {
          if (m && typeof m === 'object' && 'name' in m && (m as any).name) {
            members.push(m);
            
            // If it's a RelationEntity, also index forward/reverse members
            if (m.$type === 'RelationEntity') {
              if ((m as any).forwardRelation?.name) {
                members.push((m as any).forwardRelation);
              }
              if ((m as any).reverseRelation?.name) {
                members.push((m as any).reverseRelation);
              }
            }

            // If it's an UnreifiedRelation, index its reverse relation as well
            if (m.$type === 'UnreifiedRelation') {
              if ((m as any).reverseRelation?.name) {
                members.push((m as any).reverseRelation);
              }
            }
          }
        }

        // Add descriptions for prefixed QNames and IRI forms pointing to actual nodes
        for (const node of members) {
          const name = (node as any).name as string;
          if (!name) continue;
          
          try {
            const qname = `${imp.prefix}:${name}`;
            const desc1 = this.descriptions.createDescription(node, qname, importedDoc);
            result = this.createScope(stream([desc1]), result);
          } catch {
            // Ignore errors during description creation
          }
          
          try {
            const separator = namespace.endsWith('#') || namespace.endsWith('/') ? '' : '#';
            const iriName = `<${namespace}${separator}${name}>`;
            const desc2 = this.descriptions.createDescription(node, iriName, importedDoc);
            result = this.createScope(stream([desc2]), result);
          } catch {
            // Ignore errors during description creation
          }
        }
        }
      }
    }

    return result;
  }
}
