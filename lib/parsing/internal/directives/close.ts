import { apply, seq, tok } from 'typescript-parsec';

import { CloseDirectiveSpec } from '../../spec/directives/close.js';
import { accountParser } from '../account.js';
import { dateParser } from '../date.js';
import { makeSourcePosition } from '../source-position.js';
import { TokenKind } from '../tokenizer.js';

export const closeDirectiveParser = apply(
  seq(dateParser, tok(TokenKind.KEYWORD_close), accountParser),
  ([date, , account], tokenRange): CloseDirectiveSpec => ({
    type: 'close',
    date,
    account,
    srcPos: makeSourcePosition(tokenRange),
  }),
);
