import { apply, seq, tok } from 'typescript-parsec';

import { LoadDirectiveSpec } from '../../spec/directives/load.js';
import { metadataParser } from '../metadata.js';
import { makeSourcePosition } from '../source-position.js';
import { stringParser } from '../string.js';
import { TokenKind } from '../tokenizer.js';

export const loadDirectiveParser = apply(
  seq(tok(TokenKind.KEYWORD_load), stringParser, metadataParser),
  ([, path, meta], tokenRange): LoadDirectiveSpec => ({
    type: 'load',
    path,
    meta,
    srcPos: makeSourcePosition(tokenRange),
  }),
);
