import { DefaultValueConverter, GrammarAST } from 'langium';
import type { CstNode, ValueType } from 'langium';

/**
 * Normalizes NAMESPACE tokens by stripping surrounding angle brackets when used via RuleCall.
 * This ensures that namespace values stored in the AST are consistent and don't include the brackets.
 */
export class OmlValueConverter extends DefaultValueConverter {
  protected override runConverter(rule: GrammarAST.AbstractRule, input: string, cstNode: CstNode): ValueType {
    const source: any = (cstNode as any).grammarSource;
    if (rule.name === 'NAMESPACE' && source?.$type === 'RuleCall') {
      // Strip angle brackets from namespace: <http://example.com#> -> http://example.com#
      return input.substring(1, input.length - 1);
    }
    return super.runConverter(rule, input, cstNode);
  }
}
