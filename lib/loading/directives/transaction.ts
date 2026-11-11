import { NormalBalanceSide } from '../../core/account.js';
import { Amount } from '../../core/amount.js';
import { SignConvention } from '../../core/sign-convention.js';
import { DateSpec } from '../../parsing/spec/date.js';
import { DatedDirectiveCommon } from '../directive.js';
import { Metadata } from '../metadata.js';
import { AccountChoiceRule } from './account-choice.js';

export interface CostSpec {
  readonly kind: 'per-unit' | 'total';
  readonly amounts: Amount[];
  readonly currencies: string[];
  readonly dateSpecs: DateSpec[];
  readonly dates: Date[];
  readonly tags: string[];
}

export interface PriceSpec {
  readonly kind: 'per-unit' | 'total';
  readonly amount: Amount;
}

export interface AccountPosting {
  readonly account: string;
  readonly flag: string;
  readonly amount: Amount | null;
  readonly costSpec: CostSpec | null;
  readonly priceSpec: PriceSpec | null;
  readonly meta: Metadata;
  readonly normalBalanceSide: NormalBalanceSide;
}

export interface AccountChoiceInline {
  readonly type: 'inline';
  readonly rules: readonly AccountChoiceRule[];
}

export interface AccountChoiceRef {
  readonly type: 'ref';
  readonly name: string;
}

export type AccountChoice = AccountChoiceInline | AccountChoiceRef;

export interface AccountChoicePosting {
  readonly account: AccountChoice;
  readonly flag: string;
  readonly meta: Metadata;
}

export type Posting = AccountPosting | AccountChoicePosting;

export interface TransactionDirective extends DatedDirectiveCommon<'transaction'> {
  readonly dateSpec: DateSpec;
  readonly description: string;
  readonly flag: string;
  readonly postings: readonly Posting[];
  readonly signConvention: SignConvention;
}
