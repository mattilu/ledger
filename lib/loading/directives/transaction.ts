import { Amount } from '../../core/amount.js';
import { DateSpec } from '../../parsing/spec/date.js';
import { DirectiveCommon } from '../directive.js';
import { Metadata } from '../metadata.js';

export interface CostSpec {
  readonly kind: 'per-unit' | 'total';
  readonly amounts: Amount[];
  readonly currencies: string[];
  readonly dateSpecs: DateSpec[];
  readonly dates: Date[];
  readonly tags: string[];
}

export interface Posting {
  readonly account: string;
  readonly flag: string;
  readonly amount: Amount | null;
  readonly costSpec: CostSpec | null;
  readonly meta: Metadata;
}

export interface TransactionDirective extends DirectiveCommon<'transaction'> {
  readonly dateSpec: DateSpec;
  readonly description: string;
  readonly flag: string;
  readonly postings: readonly Posting[];
}
