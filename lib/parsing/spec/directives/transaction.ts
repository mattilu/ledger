import { Amount } from '../../../core/amount.js';
import { DateSpec } from '../date.js';
import { DirectiveCommonSpec } from '../directive.js';

export interface PostingSpec {
  readonly account: string;
  readonly amount: Amount | null;
}

export interface TransactionDirectiveSpec
  extends DirectiveCommonSpec<'transaction'> {
  readonly date: DateSpec;
  readonly description: string;
  readonly postings: readonly PostingSpec[];
}
