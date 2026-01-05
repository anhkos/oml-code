/**
 * OML Node Kind Provider
 * Maps OML AST node types to appropriate LSP SymbolKind and CompletionItemKind values
 * for better DocumentSymbol and WorkspaceSymbol presentation.
 */

import type { AstNode } from 'langium';
import { DefaultNodeKindProvider } from 'langium/lsp';
import { CompletionItemKind, SymbolKind } from 'vscode-languageserver';

/**
 * Custom NodeKindProvider for OML that returns appropriate SymbolKind
 * values based on the OML AST node type.
 */
export class OmlNodeKindProvider extends DefaultNodeKindProvider {

  /**
   * Returns the appropriate SymbolKind for an OML AST node.
   * Used by DocumentSymbolProvider and WorkspaceSymbolProvider.
   */
  override getSymbolKind(node: AstNode): SymbolKind {
    switch (node.$type) {
      // Ontologies
      case 'Vocabulary':
      case 'VocabularyBundle':
        return SymbolKind.Module;
      
      case 'Description':
      case 'DescriptionBundle':
        return SymbolKind.Package;

      // Entities (Types)
      case 'Concept':
        return SymbolKind.Class;
      
      case 'Aspect':
        return SymbolKind.Interface;
      
      case 'RelationEntity':
        return SymbolKind.Struct;

      // Relations
      case 'UnreifiedRelation':
      case 'ForwardRelation':
      case 'ReverseRelation':
        return SymbolKind.Method;

      // Properties
      case 'ScalarProperty':
        return SymbolKind.Property;
      
      case 'AnnotationProperty':
        return SymbolKind.Constant;

      // Scalars
      case 'Scalar':
        return SymbolKind.TypeParameter;

      // Instances
      case 'ConceptInstance':
      case 'RelationInstance':
        return SymbolKind.Object;

      // Rules and BuiltIns
      case 'Rule':
      case 'BuiltIn':
        return SymbolKind.Function;

      // Default fallback
      default:
        return SymbolKind.Field;
    }
  }

  /**
   * Returns the appropriate CompletionItemKind for an OML AST node.
   * Used by CompletionProvider to display appropriate icons.
   */
  override getCompletionItemKind(node: AstNode): CompletionItemKind {
    switch (node.$type) {
      // Ontologies
      case 'Vocabulary':
      case 'VocabularyBundle':
        return CompletionItemKind.Module;
      
      case 'Description':
      case 'DescriptionBundle':
        return CompletionItemKind.Folder;

      // Entities (Types)
      case 'Concept':
        return CompletionItemKind.Class;
      
      case 'Aspect':
        return CompletionItemKind.Interface;
      
      case 'RelationEntity':
        return CompletionItemKind.Struct;

      // Relations
      case 'UnreifiedRelation':
      case 'ForwardRelation':
      case 'ReverseRelation':
        return CompletionItemKind.Method;

      // Properties
      case 'ScalarProperty':
        return CompletionItemKind.Property;
      
      case 'AnnotationProperty':
        return CompletionItemKind.Constant;

      // Scalars
      case 'Scalar':
        return CompletionItemKind.TypeParameter;

      // Instances
      case 'ConceptInstance':
      case 'RelationInstance':
        return CompletionItemKind.Value;

      // Rules and BuiltIns
      case 'Rule':
      case 'BuiltIn':
        return CompletionItemKind.Function;

      // Default fallback
      default:
        return CompletionItemKind.Reference;
    }
  }
}
