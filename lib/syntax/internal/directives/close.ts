import { apply, Parser, seq } from 'typescript-parsec';

import { CloseDirectiveCst } from '../../cst/directives/close.js';
import { TokenKind } from '../../token.js';
import { dateCstParser } from '../date.js';
import { metadataCstParser } from '../metadata.js';
import { richStr, richTok } from '../primitives.js';
import { spanFromRange } from '../source-span.js';

export const closeDirectiveCstParser: Parser<TokenKind, CloseDirectiveCst> =
  apply(
    seq(
      dateCstParser,
      richStr('close'),
      richTok(TokenKind.Account),
      metadataCstParser,
    ),
    ([date, keywordToken, accountToken, metadata], range) => ({
      type: 'close',
      date,
      keywordToken,
      accountToken,
      metadata,
      span: spanFromRange(range),
    }),
  );
