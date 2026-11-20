import { apply, Parser, seq } from 'typescript-parsec';

import { AmountCst } from '../cst/amount.js';
import { TokenKind } from '../token.js';
import { expressionCstParser } from './expression.js';
import { richTok } from './primitives.js';
import { spanFromRange } from './source-span.js';

export const amountCstParser: Parser<TokenKind, AmountCst> = apply(
  seq(expressionCstParser, richTok(TokenKind.Currency)),
  ([amount, currencyToken], range): AmountCst => ({
    amount,
    currencyToken,
    span: spanFromRange(range),
  }),
);
