import { alt_sc, apply, seq, tok } from 'typescript-parsec';

import { CurrencyDirectiveSpec } from '../../spec/directives/currency.js';
import { currencyParser } from '../currency.js';
import { dateParser } from '../date.js';
import { metadataParser } from '../metadata.js';
import { makeSourcePosition } from '../source-position.js';
import { TokenKind } from '../tokenizer.js';

export const currencyDirectiveParser = apply(
  seq(
    dateParser,
    alt_sc(tok(TokenKind.KEYWORD_currency), tok(TokenKind.KEYWORD_commodity)),
    currencyParser,
    metadataParser,
  ),
  ([date, token, currency, meta], tokenRange): CurrencyDirectiveSpec => ({
    type: token.kind === TokenKind.KEYWORD_currency ? 'currency' : 'commodity',
    date,
    currency,
    meta,
    srcPos: makeSourcePosition(tokenRange),
  }),
);
