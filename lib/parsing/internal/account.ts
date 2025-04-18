import { apply, tok } from 'typescript-parsec';

import { TokenKind } from './tokenizer.js';

export const accountParser = apply(tok(TokenKind.Account), token => token.text);
