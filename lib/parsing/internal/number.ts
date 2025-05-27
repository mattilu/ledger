import { ExactNumber } from 'exactnumber';
import { apply, tok } from 'typescript-parsec';

import { TokenKind } from './tokenizer.js';

export const numberParser = apply(tok(TokenKind.NumberLiteral), token =>
  ExactNumber(token.text.replaceAll(',', '')),
);
