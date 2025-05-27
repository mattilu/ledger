import { alt_sc, apply, rep_sc } from 'typescript-parsec';

import { LedgerSpec } from '../spec/ledger.js';
import { balanceDirectiveParser } from './directives/balance.js';
import { closeDirectiveParser } from './directives/close.js';
import { loadDirectiveParser } from './directives/load.js';
import { openDirectiveParser } from './directives/open.js';
import { optionDirectiveParser } from './directives/option.js';
import { transactionDirectiveParser } from './directives/transaction.js';

const directiveParser = alt_sc(
  balanceDirectiveParser,
  closeDirectiveParser,
  loadDirectiveParser,
  openDirectiveParser,
  optionDirectiveParser,
  transactionDirectiveParser,
);

export const ledgerParser = apply(
  rep_sc(directiveParser),
  (directives): LedgerSpec => ({
    directives,
  }),
);
