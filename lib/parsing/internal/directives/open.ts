import { apply, rep_sc, seq, tok } from 'typescript-parsec';

import { OpenDirectiveSpec } from '../../spec/directives/open.js';
import { accountParser } from '../account.js';
import { currencyParser } from '../currency.js';
import { dateParser } from '../date.js';
import { makeSourcePosition } from '../source-position.js';
import { TokenKind } from '../tokenizer.js';

export const openDirectiveParser = apply(
  seq(
    dateParser,
    tok(TokenKind.KEYWORD_open),
    accountParser,
    rep_sc(currencyParser),
  ),
  ([date, , account, currencies], tokenRange): OpenDirectiveSpec => ({
    type: 'open',
    date,
    account,
    currencies: currencies,
    srcPos: makeSourcePosition(tokenRange),
  }),
);
