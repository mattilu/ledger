import { ExactNumberType } from 'exactnumber';

import { AmountSpec } from './amount.js';
import { DateSpec } from './date.js';
import { Expression } from './expression.js';

export type ConditionLiteral =
  | { readonly type: 'identifier'; readonly value: string }
  | { readonly type: 'string'; readonly value: string }
  | { readonly type: 'number'; readonly value: Expression }
  | { readonly type: 'amount'; readonly value: AmountSpec }
  | { readonly type: 'date'; readonly value: DateSpec }
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
  | { readonly type: 'not'; readonly expr: ConditionExpression }
  | {
      readonly type: 'and' | 'or';
      readonly lhs: ConditionExpression;
      readonly rhs: ConditionExpression;
    };
