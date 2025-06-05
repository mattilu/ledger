import { Expression } from './expression.js';

export interface AmountSpec {
  readonly amount: Expression;
  readonly currency: string;
}
