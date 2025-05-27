import { apply, rep_sc, seq, tok } from 'typescript-parsec';

import { BalanceDirectiveSpec } from '../../spec/directives/balance.js';
import { accountParser } from '../account.js';
import { amountParser } from '../amount.js';
import { dateParser } from '../date.js';
import { makeSourcePosition } from '../source-position.js';
import { TokenKind } from '../tokenizer.js';

export const balanceDirectiveParser = apply(
  seq(
    dateParser,
    tok(TokenKind.KEYWORD_balance),
    rep_sc(seq(accountParser, amountParser)),
  ),
  ([date, , accountAmountList], tokenRange): BalanceDirectiveSpec => ({
    type: 'balance',
    date,
    balances: accountAmountList.map(([account, amount]) => ({
      account,
      amount,
    })),
    srcPos: makeSourcePosition(tokenRange),
  }),
);
