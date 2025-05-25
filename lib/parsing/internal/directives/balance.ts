import { apply, seq, tok } from 'typescript-parsec';

import { BalanceDirectiveSpec } from '../../spec/directives/balance.js';
import { accountParser } from '../account.js';
import { amountParser } from '../amount.js';
import { dateParser } from '../date.js';
import { makeSourcePosition } from '../source-position.js';
import { TokenKind } from '../tokenizer.js';

export const balanceDirectiveParser = apply(
  seq(dateParser, tok(TokenKind.KEYWORD_balance), accountParser, amountParser),
  ([date, , account, amount], tokenRange): BalanceDirectiveSpec => ({
    type: 'balance',
    date,
    account,
    amount,
    srcPos: makeSourcePosition(tokenRange),
  }),
);
