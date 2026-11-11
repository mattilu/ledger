import { apply, seq, str } from 'typescript-parsec';

import { OptionDirectiveSpec } from '../../spec/directives/option.js';
import { metadataParser } from '../metadata.js';
import { makeSourcePosition } from '../source-position.js';
import { stringParser } from '../string.js';

export const optionDirectiveParser = apply(
  seq(str('option'), stringParser, stringParser, metadataParser),
  ([, name, value, meta], tokenRange): OptionDirectiveSpec => ({
    type: 'option',
    optionName: name,
    optionValue: value,
    meta,
    srcPos: makeSourcePosition(tokenRange),
  }),
);
