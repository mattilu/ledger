import { apply, seq, str } from 'typescript-parsec';

import { LoadDirectiveSpec } from '../../spec/directives/load.js';
import { metadataParser } from '../metadata.js';
import { makeSourcePosition } from '../source-position.js';
import { stringParser } from '../string.js';

export const loadDirectiveParser = apply(
  seq(str('load'), stringParser, metadataParser),
  ([, path, meta], tokenRange): LoadDirectiveSpec => ({
    type: 'load',
    path,
    meta,
    srcPos: makeSourcePosition(tokenRange),
  }),
);
