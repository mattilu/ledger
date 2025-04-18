import { alt_sc, apply, rep_sc } from 'typescript-parsec';

import { LedgerSpec } from '../spec/ledger.js';
import { openDirectiveParser } from './directives/open.js';
import { transactionDirectiveParser } from './directives/transaction.js';

const directiveParser = alt_sc(openDirectiveParser, transactionDirectiveParser);

export const ledgerParser = apply(
  rep_sc(directiveParser),
  (directives): LedgerSpec => ({
    directives,
  }),
);
