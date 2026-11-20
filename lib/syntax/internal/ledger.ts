import { alt_sc, Parser } from 'typescript-parsec';

import { DirectiveCst, ResilientDirectiveCst } from '../cst/directive.js';
import { BalanceEntryCst } from '../cst/directives/balance.js';
import { PostingCst } from '../cst/directives/transaction.js';
import { ErrorCst } from '../cst/error.js';
import { TokenKind } from '../token.js';
import { rep_sc } from './combinators.js';
import { accountRuleDirectiveCstParser } from './directives/account-rule.js';
import {
  balanceDirectiveCstParser,
  balanceEntryCstParser,
  makeBalanceDirectiveCstParser,
} from './directives/balance.js';
import { closeDirectiveCstParser } from './directives/close.js';
import { currencyDirectiveCstParser } from './directives/currency.js';
import { loadDirectiveCstParser } from './directives/load.js';
import { openDirectiveCstParser } from './directives/open.js';
import { optionDirectiveCstParser } from './directives/option.js';
import { priceDirectiveCstParser } from './directives/price.js';
import {
  makeTransactionDirectiveCstParser,
  postingCstParser,
  transactionDirectiveCstParser,
} from './directives/transaction.js';
import {
  isBalanceEntryStart,
  isDirectiveStart,
  isPostingStart,
  isTopLevelDateStart,
  recoverUntil,
} from './recover.js';

const strictDirectiveCstParser: Parser<TokenKind, DirectiveCst> = alt_sc(
  transactionDirectiveCstParser,
  accountRuleDirectiveCstParser,
  balanceDirectiveCstParser,
  closeDirectiveCstParser,
  currencyDirectiveCstParser,
  loadDirectiveCstParser,
  openDirectiveCstParser,
  optionDirectiveCstParser,
  priceDirectiveCstParser,
);

export const ledgerDirectivesCstParser: Parser<
  TokenKind,
  readonly DirectiveCst[]
> = rep_sc(strictDirectiveCstParser);

const resilientPostingParser: Parser<TokenKind, PostingCst | ErrorCst> =
  recoverUntil(
    postingCstParser,
    (tok, braceDepth) =>
      isDirectiveStart(tok, braceDepth > 0) ||
      (braceDepth === 0 && (isTopLevelDateStart(tok) || isPostingStart(tok))),
    tok => !isDirectiveStart(tok) && !isTopLevelDateStart(tok),
  );

const resilientBalanceEntryParser: Parser<
  TokenKind,
  BalanceEntryCst | ErrorCst
> = recoverUntil(
  balanceEntryCstParser,
  (tok, braceDepth) =>
    isDirectiveStart(tok, braceDepth > 0) ||
    (braceDepth === 0 &&
      (isTopLevelDateStart(tok) || isBalanceEntryStart(tok))),
  tok => !isDirectiveStart(tok) && !isTopLevelDateStart(tok),
);

const resilientSingleDirectiveParser: Parser<
  TokenKind,
  DirectiveCst<PostingCst | ErrorCst, BalanceEntryCst | ErrorCst>
> = alt_sc(
  makeTransactionDirectiveCstParser(resilientPostingParser),
  accountRuleDirectiveCstParser,
  makeBalanceDirectiveCstParser(resilientBalanceEntryParser),
  closeDirectiveCstParser,
  currencyDirectiveCstParser,
  loadDirectiveCstParser,
  openDirectiveCstParser,
  optionDirectiveCstParser,
  priceDirectiveCstParser,
);

export const resilientLedgerDirectivesCstParser: Parser<
  TokenKind,
  readonly ResilientDirectiveCst[]
> = rep_sc(
  recoverUntil(
    resilientSingleDirectiveParser,
    (tok, braceDepth) =>
      isDirectiveStart(tok, braceDepth > 0) ||
      (braceDepth === 0 && isTopLevelDateStart(tok)),
  ),
);
