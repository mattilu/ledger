import { AmountSpec } from '../amount.js';
import { DateSpec } from '../date.js';
import { DirectiveCommonSpec } from '../directive.js';
import { MetadataSpec } from '../metadata.js';

export interface CostSpec {
  readonly kind: 'per-unit' | 'total';
  readonly amounts: AmountSpec[];
}

export interface PostingSpec {
  readonly account: string;
  readonly flag: string | null;
  readonly amount: AmountSpec | null;
  readonly costSpec: CostSpec | null;
  readonly meta: MetadataSpec;
}

export interface TransactionDirectiveSpec
  extends DirectiveCommonSpec<'transaction'> {
  readonly date: DateSpec;
  readonly description: string;
  readonly flag: string;
  readonly postings: readonly PostingSpec[];
}
