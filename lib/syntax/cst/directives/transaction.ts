import { RichToken } from '../../token.js';
import { AmountCst } from '../amount.js';
import { CstNodeCommon } from '../common.js';
import { DateCst } from '../date.js';
import { DirectiveCommonCst } from '../directive.js';
import { MetadataEntryCst } from '../metadata.js';
import { RuleBlockCst } from './account-rule.js';

export type CostItemValueCst =
  | { readonly kind: 'amount'; readonly amount: AmountCst }
  | { readonly kind: 'currency'; readonly token: RichToken }
  | { readonly kind: 'date'; readonly date: DateCst }
  | { readonly kind: 'tag'; readonly token: RichToken };

export interface CostItemCst extends CstNodeCommon {
  readonly value: CostItemValueCst;
  readonly commaToken: RichToken | null;
}

export interface CostSpecCst extends CstNodeCommon {
  readonly kind: 'per-unit' | 'total';
  readonly openToken: RichToken;
  readonly items: readonly CostItemCst[];
  readonly closeToken: RichToken;
}

export interface PriceSpecCst extends CstNodeCommon {
  readonly kind: 'per-unit' | 'total';
  readonly opToken: RichToken;
  readonly amount: AmountCst;
}

export interface AccountPostingCst extends CstNodeCommon {
  readonly type: 'account-posting';
  readonly flagToken: RichToken | null;
  readonly accountToken: RichToken;
  readonly amount: AmountCst | null;
  readonly costSpec: CostSpecCst | null;
  readonly priceSpec: PriceSpecCst | null;
  readonly metadata: readonly MetadataEntryCst[];
}

export type AccountChoiceTargetCst =
  | { readonly type: 'inline'; readonly block: RuleBlockCst }
  | { readonly type: 'ref'; readonly nameToken: RichToken };

export interface AccountChoicePostingCst extends CstNodeCommon {
  readonly type: 'account-choice-posting';
  readonly flagToken: RichToken | null;
  readonly chooseToken: RichToken;
  readonly accountKeywordToken: RichToken;
  readonly target: AccountChoiceTargetCst;
  readonly metadata: readonly MetadataEntryCst[];
}

export type PostingCst = AccountPostingCst | AccountChoicePostingCst;

export interface TransactionDirectiveCst<
  TPosting = PostingCst,
> extends DirectiveCommonCst<'transaction'> {
  readonly date: DateCst;
  readonly flagToken: RichToken;
  readonly descriptionToken: RichToken;
  readonly postings: readonly TPosting[];
}
