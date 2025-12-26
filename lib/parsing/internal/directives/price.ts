import { apply, seq, tok } from 'typescript-parsec';

import { PriceDirectiveSpec } from '../../spec/directives/price.js';
import { amountParser } from '../amount.js';
import { currencyParser } from '../currency.js';
import { dateParser } from '../date.js';
import { metadataParser } from '../metadata.js';
import { makeSourcePosition } from '../source-position.js';
import { TokenKind } from '../tokenizer.js';

export const priceDirectiveParser = apply(
  seq(
    dateParser,
    tok(TokenKind.KEYWORD_price),
    currencyParser,
    amountParser,
    metadataParser,
  ),
  ([date, , currency, price, meta], tokenRange): PriceDirectiveSpec => ({
    type: 'price',
    date,
    currency,
    price,
    meta,
    srcPos: makeSourcePosition(tokenRange),
  }),
);
