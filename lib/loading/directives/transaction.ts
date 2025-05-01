import { Amount } from '../../core/amount.js';
import { CostSpec } from '../../parsing/spec/directives/transaction.js';
import { DirectiveCommon } from '../directive.js';

export interface Posting {
  readonly account: string;
  readonly amount: Amount | null;
  readonly costSpec: CostSpec | null;
}

export interface TransactionDirective extends DirectiveCommon<'transaction'> {
  readonly description: string;
  readonly postings: readonly Posting[];
}
