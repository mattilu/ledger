import { alt_sc, apply, Parser, seq } from 'typescript-parsec';

import { MetadataEntryCst, MetadataValueCst } from '../cst/metadata.js';
import { TokenKind } from '../token.js';
import { amountCstParser } from './amount.js';
import { rep_sc } from './combinators.js';
import { dateCstParser } from './date.js';
import { expressionCstParser } from './expression.js';
import { richTok } from './primitives.js';
import { spanFromRange } from './source-span.js';

const metadataValueCstParser: Parser<TokenKind, MetadataValueCst> = alt_sc(
  apply(richTok(TokenKind.StringLiteral), token => ({
    type: 'string',
    token,
  })),
  apply(richTok(TokenKind.Account), token => ({
    type: 'account',
    token,
  })),
  apply(richTok(TokenKind.Currency), token => ({
    type: 'currency',
    token,
  })),
  apply(dateCstParser, date => ({
    type: 'date',
    date,
  })),
  apply(amountCstParser, amount => ({
    type: 'amount',
    amount,
  })),
  apply(expressionCstParser, expr => ({
    type: 'number',
    expr,
  })),
);

const metadataEntryCstParser: Parser<TokenKind, MetadataEntryCst> = apply(
  seq(
    richTok(TokenKind.Identifier),
    richTok(TokenKind.Colon),
    metadataValueCstParser,
  ),
  ([keyToken, colonToken, value], range): MetadataEntryCst => ({
    keyToken,
    colonToken,
    value,
    span: spanFromRange(range),
  }),
);

export const metadataCstParser: Parser<TokenKind, readonly MetadataEntryCst[]> =
  rep_sc(metadataEntryCstParser);
