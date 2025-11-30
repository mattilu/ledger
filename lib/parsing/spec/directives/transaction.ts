import { AmountSpec } from '../amount.js';
import { DateSpec } from '../date.js';
import { DirectiveCommonSpec } from '../directive.js';
import { MetadataSpec } from '../metadata.js';

export interface CostSpec {
  readonly kind: 'per-unit' | 'total';
  readonly amounts: AmountSpec[];
  /** For reductions, currencies to filter inventories on. */
  readonly currencies: string[];
  /**
   * For augmentations, can specify the date of the Cost, if different than the
   * transaction date (at most one).
   * For reductions, can specify dates to filter inventories on.
   */
  readonly dates: DateSpec[];
  /**
   * For augmentation, can specify tags to attach to the Cost.
   * For reductions, can specify tags to filter inventories on.
   */
  readonly tags: string[];
}

export interface PostingSpec {
  readonly account: string;
  readonly flag: string | null;
  readonly amount: AmountSpec | null;
  readonly costSpec: CostSpec | null;
  readonly meta: MetadataSpec;
}

export interface TransactionDirectiveSpec extends DirectiveCommonSpec<'transaction'> {
  readonly date: DateSpec;
  readonly description: string;
  readonly flag: string;
  readonly postings: readonly PostingSpec[];
}
