import { apply, Parser, seq } from 'typescript-parsec';

import { PriceDirectiveCst } from '../../cst/directives/price.js';
import { TokenKind } from '../../token.js';
import { amountCstParser } from '../amount.js';
import { dateCstParser } from '../date.js';
import { metadataCstParser } from '../metadata.js';
import { richStr, richTok } from '../primitives.js';
import { spanFromRange } from '../source-span.js';

export const priceDirectiveCstParser: Parser<TokenKind, PriceDirectiveCst> =
  apply(
    seq(
      dateCstParser,
      richStr('price'),
      richTok(TokenKind.Currency),
      amountCstParser,
      metadataCstParser,
    ),
    ([date, keywordToken, currencyToken, price, metadata], range) => ({
      type: 'price',
      date,
      keywordToken,
      currencyToken,
      price,
      metadata,
      span: spanFromRange(range),
    }),
  );
