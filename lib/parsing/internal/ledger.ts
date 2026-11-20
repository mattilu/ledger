import { alt_sc, apply } from 'typescript-parsec';

import { LedgerSpec } from '../spec/ledger.js';
import { rep_sc } from './combinators.js';
import { accountRuleDirectiveParser } from './directives/account-rule.js';
import { balanceDirectiveParser } from './directives/balance.js';
import { closeDirectiveParser } from './directives/close.js';
import { currencyDirectiveParser } from './directives/currency.js';
import { loadDirectiveParser } from './directives/load.js';
import { openDirectiveParser } from './directives/open.js';
import { optionDirectiveParser } from './directives/option.js';
import { priceDirectiveParser } from './directives/price.js';
import { transactionDirectiveParser } from './directives/transaction.js';

const directiveParser = alt_sc(
  accountRuleDirectiveParser,
  balanceDirectiveParser,
  closeDirectiveParser,
  currencyDirectiveParser,
  loadDirectiveParser,
  openDirectiveParser,
  optionDirectiveParser,
  priceDirectiveParser,
  transactionDirectiveParser,
);

export const ledgerParser = apply(
  rep_sc(directiveParser),
  (directives): LedgerSpec => ({
    directives,
  }),
);
