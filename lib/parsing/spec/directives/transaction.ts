import { AmountSpec } from '../amount.js';
import { DateSpec } from '../date.js';
import { DirectiveCommonSpec } from '../directive.js';
import { MetadataSpec } from '../metadata.js';
import { AccountChoiceRule } from './account-rule.js';

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

export interface PriceSpec {
  readonly kind: 'per-unit' | 'total';
  readonly amount: AmountSpec;
}

export interface AccountPostingSpec {
  readonly account: string;
  readonly flag: string | null;
  readonly amount: AmountSpec | null;
  readonly costSpec: CostSpec | null;
  readonly priceSpec: PriceSpec | null;
  readonly meta: MetadataSpec;
}

export type AccountChoiceSpec =
  | { readonly type: 'inline'; readonly rules: readonly AccountChoiceRule[] }
  | { readonly type: 'ref'; readonly name: string };

export interface AccountChoicePostingSpec {
  readonly account: AccountChoiceSpec;
  readonly flag: string | null;
  readonly meta: MetadataSpec;
}

export type PostingSpec = AccountPostingSpec | AccountChoicePostingSpec;

export interface TransactionDirectiveSpec extends DirectiveCommonSpec<'transaction'> {
  readonly date: DateSpec;
  readonly description: string;
  readonly flag: string;
  readonly postings: readonly PostingSpec[];
}
