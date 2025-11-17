import type { AstNodeDescription, ReferenceInfo, Stream } from 'langium';
import type { CompletionItem, TextEdit } from 'vscode-languageserver-types';
import { DefaultCompletionProvider, type CompletionContext, type CompletionValueItem } from 'langium/lsp';
import { Element, isDescription, isDescriptionBox, isMember, isOntology, isVocabulary, isVocabularyBundle, Member, Ontology } from './generated/ast.js';

/**
 * OML Completion Provider - Grammar-aware completions using Langium LSP
 * Extends Langium's DefaultCompletionProvider to customize completion behavior for OML
 */
export class OmlCompletionProvider extends DefaultCompletionProvider {

  /**
   * Get reference candidates - include both local definitions and imported IRIs
   * Local definitions don't start with '<', imported ones do
   */
  protected override getReferenceCandidates(refInfo: ReferenceInfo, _context: CompletionContext): Stream<AstNodeDescription> {
    // Return all elements in scope (both local and imported)
    return this.scopeProvider.getScope(refInfo).getAllElements();
  }

  /**
   * Customize completion text edit to replace the entire token
   */
  protected override buildCompletionTextEdit(context: CompletionContext, _label: string, newText: string): TextEdit | undefined {
    const start = context.textDocument.positionAt(context.tokenOffset);
    const end = context.position;
    return { newText, range: { start, end } };
  }

  /**
   * Fill completion item with OML-specific details:
   * - Show abbreviated IRIs (prefix:name) instead of full IRIs
   * - Include namespace in detail
   * - Auto-generate import statements for cross-file references
   */
  protected override fillCompletionItem(context: CompletionContext, item: CompletionValueItem): CompletionItem | undefined {
    if ('nodeDescription' in item) {
      const desc = item.nodeDescription;
      
      // Check if this is a member reference (could be a cross-file reference)
      if (desc.node && isMember(desc.node)) {
        const member = desc.node as Member;
        const [namespace, name] = this.getIri(member);
        const ontology = context.document.parseResult.value as Ontology;
        
        // Find existing import for this namespace
        const imp = ontology.ownedImports?.find((i: any) => {
          const importedNS = i.imported?.ref?.namespace?.replace(/^<|>$/g, '');
          return importedNS === namespace;
        });
        
        const importedOntology = this.getOntology(member);
        const prefix = (imp && imp.prefix) ? imp.prefix : importedOntology.prefix;
        
        // Build abbreviated IRI: prefix:name (or just name if same ontology)
        const abbreviatedIri = (ontology !== importedOntology && prefix) ? `${prefix}:${name}` : name;
        
        item = { ...item, detail: namespace, label: abbreviatedIri };
        
        // Auto-generate import statement if not already imported and from different ontology
        if (!imp && ontology !== importedOntology) {
          const importStatement = this.getImportStatement(ontology, importedOntology);
          
          if (importStatement) {
            // Find insertion point: after last import or after opening brace
            const lastImport = ontology.ownedImports?.at(-1);
            let insertOffset: number;
            
            if (lastImport && lastImport.$cstNode) {
              insertOffset = lastImport.$cstNode.offset + lastImport.$cstNode.length;
            } else {
              // No imports yet - insert after opening brace
              const text = context.textDocument.getText();
              insertOffset = text.indexOf('{') + 1;
            }
            
            const start = context.textDocument.positionAt(insertOffset);
            const addImportStatement: TextEdit = {
              newText: '\n\n\t' + importStatement,
              range: { start, end: start }
            };
            
            item = { ...item, additionalTextEdits: [addImportStatement] };
          }
        }
      }
    }
    return super.fillCompletionItem(context, item);
  }

  /**
   * Extract IRI components (namespace and name) from a member
   */
  getIri(member: Member): [string, string] {
    return [this.getOntology(member).namespace.replace(/^<|>$/g, ''), member.name!];
  }

  /**
   * Get the ontology containing an element
   */
  getOntology(element: Element): Ontology {
    while (element && !isOntology(element)) {
      element = (element as any).$container;
    }
    return element as Ontology;
  }

  /**
   * Generate appropriate import statement based on ontology types
   */
  getImportStatement(importing: Ontology, imported: Ontology): string | undefined {
    if (importing.$type === imported.$type) {
      return 'extends <' + imported.namespace + '> as ' + imported.prefix;
    } else if (isVocabulary(importing) && isDescription(imported)) {
      return 'uses <' + imported.namespace + '> as ' + imported.prefix;
    } else if (isDescriptionBox(importing) && isVocabulary(imported)) {
      return 'uses <' + imported.namespace + '> as ' + imported.prefix;
    } else if (isVocabularyBundle(importing) && isVocabulary(imported)) {
      return 'includes <' + imported.namespace + '> as ' + imported.prefix;
    }
    return undefined;
  }
}
