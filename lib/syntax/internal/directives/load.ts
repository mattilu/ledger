import { apply, Parser, seq } from 'typescript-parsec';

import { LoadDirectiveCst } from '../../cst/directives/load.js';
import { TokenKind } from '../../token.js';
import { metadataCstParser } from '../metadata.js';
import { richStr, richTok } from '../primitives.js';
import { spanFromRange } from '../source-span.js';

export const loadDirectiveCstParser: Parser<TokenKind, LoadDirectiveCst> =
  apply(
    seq(richStr('load'), richTok(TokenKind.StringLiteral), metadataCstParser),
    ([keywordToken, pathToken, metadata], range) => ({
      type: 'load',
      keywordToken,
      pathToken,
      metadata,
      span: spanFromRange(range),
    }),
  );
