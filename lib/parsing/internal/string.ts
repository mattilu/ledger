import { apply, tok } from 'typescript-parsec';

import { TokenKind } from './tokenizer.js';

export const stringParser = apply(tok(TokenKind.StringLiteral), token =>
  token.text.slice(1, -1),
);
