import { apply, opt_sc, rep_sc, seq, tok } from 'typescript-parsec';

import { BalanceDirectiveSpec } from '../../spec/directives/balance.js';
import { accountParser } from '../account.js';
import { amountParser } from '../amount.js';
import { dateParser } from '../date.js';
import { expressionParser } from '../expression.js';
import { metadataParser } from '../metadata.js';
import { makeSourcePosition } from '../source-position.js';
import { TokenKind } from '../tokenizer.js';

export const balanceDirectiveParser = apply(
  seq(
    dateParser,
    tok(TokenKind.KEYWORD_balance),
    metadataParser,
    rep_sc(
      seq(
        accountParser,
        amountParser,
        opt_sc(seq(tok(TokenKind.Tilde), expressionParser)),
      ),
    ),
  ),
  ([date, , meta, accountAmountList], tokenRange): BalanceDirectiveSpec => ({
    type: 'balance',
    date,
    meta,
    balances: accountAmountList.map(([account, amount, approx]) => ({
      account,
      amount,
      approx: approx === undefined ? null : approx[1],
    })),
    srcPos: makeSourcePosition(tokenRange),
  }),
);
