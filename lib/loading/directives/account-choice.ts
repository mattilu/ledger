import { ExactNumberType } from 'exactnumber';

import { Amount } from '../../core/amount.js';
import { DirectiveCommon } from '../directive.js';

export type ConditionLiteral =
  | { readonly type: 'identifier'; readonly value: string }
  | { readonly type: 'string'; readonly value: string }
  | { readonly type: 'number'; readonly value: ExactNumberType }
  | { readonly type: 'amount'; readonly value: Amount }
  | { readonly type: 'date'; readonly value: Date }
  | { readonly type: 'account'; readonly value: string }
  | { readonly type: 'currency'; readonly value: string }
  | {
      readonly type: 'duration';
      readonly value: ExactNumberType;
      readonly unit: 'd';
    };

export type ConditionExpression =
  | {
      readonly type: 'comparison';
      readonly attribute: string;
      readonly operator:
        | 'is'
        | 'is not'
        | '=='
        | '!='
        | '<'
        | '<='
        | '>'
        | '>=';
      readonly value: ConditionLiteral;
    }
  | {
      readonly type: 'not';
      readonly expression: ConditionExpression;
    }
  | {
      readonly type: 'and' | 'or';
      readonly lhs: ConditionExpression;
      readonly rhs: ConditionExpression;
    };

export type AccountChoiceRule =
  | {
      readonly type: 'when';
      readonly condition: ConditionExpression;
      readonly account: string;
    }
  | { readonly type: 'otherwise'; readonly account: string };

export interface AccountRuleDirective extends DirectiveCommon<'account-rule'> {
  readonly name: string;
  readonly rules: readonly AccountChoiceRule[];
}
