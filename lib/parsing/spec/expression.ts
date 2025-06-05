import { ExactNumberType } from 'exactnumber';

export type Expression = Readonly<
  | { type: 'literal'; value: ExactNumberType }
  | { type: 'unary'; op: '+' | '-'; expr: Expression }
  | {
      type: 'binary';
      op: '+' | '-' | '*' | '/';
      expr1: Expression;
      expr2: Expression;
    }
>;
