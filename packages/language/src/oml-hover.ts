/**
 * OML Hover Provider
 * Provides rich hover information for OML elements with type and namespace details
 */

import type { AstNode, LangiumDocument, MaybePromise } from 'langium';
import { CstUtils } from 'langium';
import { AstNodeHoverProvider } from 'langium/lsp';
import type { LangiumServices } from 'langium/lsp';
import type { Hover, HoverParams } from 'vscode-languageserver-protocol';
import { MarkupKind } from 'vscode-languageserver-protocol';
import { isOntology } from './generated/ast.js';

export class OmlHoverProvider extends AstNodeHoverProvider {
  
  constructor(services: LangiumServices) {
    super(services);
  }

  override async getHoverContent(document: LangiumDocument, params: HoverParams): Promise<Hover | undefined> {
    const rootNode = document.parseResult?.value?.$cstNode;
    if (rootNode) {
      const offset = document.textDocument.offsetAt(params.position);
      const cstNode = CstUtils.findDeclarationNodeAtOffset(rootNode, offset, this.grammarConfig.nameRegexp);
      if (cstNode && cstNode.offset + cstNode.length > offset) {
        const contents: string[] = [];
        const targetNodes = this.references.findDeclarations(cstNode);
        for (const targetNode of targetNodes) {
          const content = await this.getAstNodeHoverContent(targetNode);
          if (typeof content === 'string') {
            contents.push(content);
          }
        }
        if (contents.length > 0) {
          // Override to use proper MarkupKind.Markdown instead of 'markdown' with language
          return {
            contents: {
              kind: MarkupKind.Markdown,
              value: contents.join('\n\n---\n\n')
            }
          };
        }
      }
    }
    return undefined;
  }

  protected getAstNodeHoverContent(node: AstNode): MaybePromise<string | undefined> {
    // The node here is the AST node under the cursor
    // Check if it has a name property (it's a definition)
    if ((node as any).name) {
      const elementType = node.$type || 'element';
      const keyword = elementType.toLowerCase();
      const name = (node as any).name;
      
      let hoverText = `**${keyword}** \`${name}\``;
      
      const ontology = this.getOntology(node);
      if (ontology?.namespace) {
        const namespace = ontology.namespace.replace(/^<|>$/g, '');
        hoverText += `\n\nDefined in: \`${namespace}\``;
      }
      
      return hoverText;
    }
    
    // For references, we want to show info about the referenced element
    const ref = (node as any).ref;
    
    if (ref && ref.name) {
      // Get the element type
      const elementType = ref.$type || 'element';
      const keyword = elementType.toLowerCase();
      
      // Build hover text: "keyword name"
      let hoverText = `**${keyword}** \`${ref.name}\``;
      
      // Add namespace if available
      const ontology = this.getOntology(ref);
      if (ontology?.namespace) {
        const namespace = ontology.namespace.replace(/^<|>$/g, '');
        hoverText += `\n\nDefined in: \`${namespace}\``;
      }
      
      return hoverText;
    }
    
    return undefined;
  }

  private getOntology(element: any): any {
    let current = element;
    while (current) {
      if (isOntology(current)) {
        return current;
      }
      current = current.$container;
    }
    return null;
  }
}
