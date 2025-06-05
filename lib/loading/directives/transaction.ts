import { Amount } from '../../core/amount.js';
import { DirectiveCommon } from '../directive.js';
import { Metadata } from '../metadata.js';

export interface CostSpec {
  readonly kind: 'per-unit' | 'total';
  readonly amounts: Amount[];
}

export interface Posting {
  readonly account: string;
  readonly flag: string;
  readonly amount: Amount | null;
  readonly costSpec: CostSpec | null;
  readonly meta: Metadata;
}

export interface TransactionDirective extends DirectiveCommon<'transaction'> {
  readonly description: string;
  readonly flag: string;
  readonly postings: readonly Posting[];
}
