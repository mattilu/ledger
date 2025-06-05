import { apply, seq, tok } from 'typescript-parsec';

import { OptionDirectiveSpec } from '../../spec/directives/option.js';
import { metadataParser } from '../metadata.js';
import { makeSourcePosition } from '../source-position.js';
import { stringParser } from '../string.js';
import { TokenKind } from '../tokenizer.js';

export const optionDirectiveParser = apply(
  seq(
    tok(TokenKind.KEYWORD_option),
    stringParser,
    stringParser,
    metadataParser,
  ),
  ([, name, value, meta], tokenRange): OptionDirectiveSpec => ({
    type: 'option',
    optionName: name,
    optionValue: value,
    meta,
    srcPos: makeSourcePosition(tokenRange),
  }),
);
