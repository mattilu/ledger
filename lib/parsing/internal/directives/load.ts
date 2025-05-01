import { apply, seq, tok } from 'typescript-parsec';

import { LoadDirectiveSpec } from '../../spec/directives/load.js';
import { makeSourcePosition } from '../source-position.js';
import { stringParser } from '../string.js';
import { TokenKind } from '../tokenizer.js';

export const loadDirectiveParser = apply(
  seq(tok(TokenKind.KEYWORD_load), stringParser),
  ([, path], tokenRange): LoadDirectiveSpec => ({
    type: 'load',
    path,
    srcPos: makeSourcePosition(tokenRange),
  }),
);
