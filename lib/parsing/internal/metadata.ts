import { Map } from 'immutable';
import { alt_sc, apply, Parser, rep_sc, seq, tok } from 'typescript-parsec';

import { MetadataSpec, MetadataValueSpec } from '../spec/metadata.js';
import { accountParser } from './account.js';
import { amountParser } from './amount.js';
import { currencyParser } from './currency.js';
import { dateParser } from './date.js';
import { expressionParser } from './expression.js';
import { stringParser } from './string.js';
import { TokenKind } from './tokenizer.js';

const valueParser: Parser<TokenKind, MetadataValueSpec> = alt_sc(
  apply(stringParser, value => ({ type: 'string', value })),
  apply(accountParser, value => ({ type: 'account', value })),
  apply(currencyParser, value => ({ type: 'currency', value })),
  apply(dateParser, value => ({ type: 'date', value })),
  apply(amountParser, value => ({ type: 'amount', value })),
  apply(expressionParser, value => ({ type: 'number', value })),
);

export const metadataParser: Parser<TokenKind, MetadataSpec> = apply(
  rep_sc(seq(tok(TokenKind.Identifier), tok(TokenKind.Colon), valueParser)),
  values =>
    Map(values.map(([identifier, , value]) => [identifier.text, value])),
);
