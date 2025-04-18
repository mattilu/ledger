import { apply, tok } from 'typescript-parsec';

import { TokenKind } from './tokenizer.js';

export const currencyParser = apply(
  tok(TokenKind.Currency),
  currency => currency.text,
);
