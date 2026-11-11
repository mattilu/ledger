import { apply, seq, str } from 'typescript-parsec';

import { PriceDirectiveSpec } from '../../spec/directives/price.js';
import { amountParser } from '../amount.js';
import { currencyParser } from '../currency.js';
import { dateParser } from '../date.js';
import { metadataParser } from '../metadata.js';
import { makeSourcePosition } from '../source-position.js';

export const priceDirectiveParser = apply(
  seq(dateParser, str('price'), currencyParser, amountParser, metadataParser),
  ([date, , currency, price, meta], tokenRange): PriceDirectiveSpec => ({
    type: 'price',
    date,
    currency,
    price,
    meta,
    srcPos: makeSourcePosition(tokenRange),
  }),
);
