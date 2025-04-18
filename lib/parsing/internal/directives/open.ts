import { apply, seq, tok } from 'typescript-parsec';

import { OpenDirectiveSpec } from '../../spec/directives/open.js';
import { accountParser } from '../account.js';
import { dateParser } from '../date.js';
import { makeSourcePosition } from '../source-position.js';
import { TokenKind } from '../tokenizer.js';

export const openDirectiveParser = apply(
  seq(dateParser, tok(TokenKind.KEYWORD_open), accountParser),
  ([date, , account], tokenRange): OpenDirectiveSpec => ({
    type: 'open',
    date,
    account,
    srcPos: makeSourcePosition(tokenRange),
  }),
);
