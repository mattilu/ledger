import { SourceSpan } from '../source-span.js';
import { RichToken } from '../token.js';
import { AmountCst } from './amount.js';
import { CstNodeCommon } from './common.js';
import { DateCst } from './date.js';
import { ExpressionCst } from './expression.js';

export type ConditionLiteralCst =
  | { readonly type: 'identifier'; readonly token: RichToken }
  | { readonly type: 'string'; readonly token: RichToken }
  | { readonly type: 'number'; readonly expr: ExpressionCst }
  | { readonly type: 'amount'; readonly amount: AmountCst }
  | { readonly type: 'date'; readonly date: DateCst }
  | { readonly type: 'account'; readonly token: RichToken }
  | { readonly type: 'currency'; readonly token: RichToken }
  | {
      readonly type: 'duration';
      readonly valueToken: RichToken;
      readonly unitToken: RichToken;
      readonly span: SourceSpan;
    };

export type ComparisonOperatorKind =
  'is' | 'is not' | '==' | '!=' | '<' | '<=' | '>' | '>=';

export interface ComparisonOperatorCst extends CstNodeCommon {
  readonly operator: ComparisonOperatorKind;
  readonly tokens: readonly RichToken[];
}

export type ConditionExpressionCst =
  | {
      readonly type: 'comparison';
      readonly attributeToken: RichToken;
      readonly operator: ComparisonOperatorCst;
      readonly value: ConditionLiteralCst;
      readonly span: SourceSpan;
    }
  | {
      readonly type: 'not';
      readonly notToken: RichToken;
      readonly expr: ConditionExpressionCst;
      readonly span: SourceSpan;
    }
  | {
      readonly type: 'and' | 'or';
      readonly opToken: RichToken;
      readonly lhs: ConditionExpressionCst;
      readonly rhs: ConditionExpressionCst;
      readonly span: SourceSpan;
    }
  | {
      readonly type: 'paren';
      readonly openParen: RichToken;
      readonly expr: ConditionExpressionCst;
      readonly closeParen: RichToken;
      readonly span: SourceSpan;
    };
