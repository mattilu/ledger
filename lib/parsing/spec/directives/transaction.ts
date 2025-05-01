import { Amount } from '../../../core/amount.js';
import { DateSpec } from '../date.js';
import { DirectiveCommonSpec } from '../directive.js';

export interface CostSpec {
  readonly kind: 'per-unit' | 'total';
  readonly amounts: Amount[];
}

export interface PostingSpec {
  readonly account: string;
  readonly amount: Amount | null;
  readonly costSpec: CostSpec | null;
}

export interface TransactionDirectiveSpec
  extends DirectiveCommonSpec<'transaction'> {
  readonly date: DateSpec;
  readonly description: string;
  readonly postings: readonly PostingSpec[];
}
