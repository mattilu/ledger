import { alt_sc, apply, Parser, seq } from 'typescript-parsec';

import { CurrencyDirectiveCst } from '../../cst/directives/currency.js';
import { TokenKind } from '../../token.js';
import { dateCstParser } from '../date.js';
import { metadataCstParser } from '../metadata.js';
import { richStr, richTok } from '../primitives.js';
import { spanFromRange } from '../source-span.js';

export const currencyDirectiveCstParser: Parser<
  TokenKind,
  CurrencyDirectiveCst
> = apply(
  seq(
    dateCstParser,
    alt_sc(richStr('currency'), richStr('commodity')),
    richTok(TokenKind.Currency),
    metadataCstParser,
  ),
  ([date, keywordToken, currencyToken, metadata], range) => ({
    type: keywordToken.text === 'currency' ? 'currency' : 'commodity',
    date,
    keywordToken,
    currencyToken,
    metadata,
    span: spanFromRange(range),
  }),
);
