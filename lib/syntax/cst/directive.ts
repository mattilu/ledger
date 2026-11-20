import { CstNodeCommon } from './common.js';
import { AccountRuleDirectiveCst } from './directives/account-rule.js';
import { BalanceDirectiveCst, BalanceEntryCst } from './directives/balance.js';
import { CloseDirectiveCst } from './directives/close.js';
import { CurrencyDirectiveCst } from './directives/currency.js';
import { LoadDirectiveCst } from './directives/load.js';
import { OpenDirectiveCst } from './directives/open.js';
import { OptionDirectiveCst } from './directives/option.js';
import { PriceDirectiveCst } from './directives/price.js';
import {
  PostingCst,
  TransactionDirectiveCst,
} from './directives/transaction.js';
import { ErrorCst } from './error.js';
import { MetadataEntryCst } from './metadata.js';

export interface DirectiveCommonCst<T extends string> extends CstNodeCommon {
  readonly type: T;
  readonly metadata: readonly MetadataEntryCst[];
}

export type DirectiveCst<
  TPosting = PostingCst,
  TBalanceEntry = BalanceEntryCst,
> =
  | AccountRuleDirectiveCst
  | BalanceDirectiveCst<TBalanceEntry>
  | CloseDirectiveCst
  | CurrencyDirectiveCst
  | LoadDirectiveCst
  | OpenDirectiveCst
  | OptionDirectiveCst
  | PriceDirectiveCst
  | TransactionDirectiveCst<TPosting>;

export type ResilientDirectiveCst =
  DirectiveCst<PostingCst | ErrorCst, BalanceEntryCst | ErrorCst> | ErrorCst;
