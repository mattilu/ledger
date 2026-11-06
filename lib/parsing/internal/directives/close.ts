import { apply, seq, str } from 'typescript-parsec';

import { CloseDirectiveSpec } from '../../spec/directives/close.js';
import { accountParser } from '../account.js';
import { dateParser } from '../date.js';
import { metadataParser } from '../metadata.js';
import { makeSourcePosition } from '../source-position.js';

export const closeDirectiveParser = apply(
  seq(dateParser, str('close'), accountParser, metadataParser),
  ([date, , account, meta], tokenRange): CloseDirectiveSpec => ({
    type: 'close',
    date,
    account,
    meta,
    srcPos: makeSourcePosition(tokenRange),
  }),
);
