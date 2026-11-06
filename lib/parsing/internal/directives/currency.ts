import { alt_sc, apply, seq, str } from 'typescript-parsec';

import { CurrencyDirectiveSpec } from '../../spec/directives/currency.js';
import { currencyParser } from '../currency.js';
import { dateParser } from '../date.js';
import { metadataParser } from '../metadata.js';
import { makeSourcePosition } from '../source-position.js';

export const currencyDirectiveParser = apply(
  seq(
    dateParser,
    alt_sc(str('currency'), str('commodity')),
    currencyParser,
    metadataParser,
  ),
  ([date, token, currency, meta], tokenRange): CurrencyDirectiveSpec => ({
    type: token.text === 'currency' ? 'currency' : 'commodity',
    date,
    currency,
    meta,
    srcPos: makeSourcePosition(tokenRange),
  }),
);
