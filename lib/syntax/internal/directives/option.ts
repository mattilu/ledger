import { apply, Parser, seq } from 'typescript-parsec';

import { OptionDirectiveCst } from '../../cst/directives/option.js';
import { TokenKind } from '../../token.js';
import { metadataCstParser } from '../metadata.js';
import { richStr, richTok } from '../primitives.js';
import { spanFromRange } from '../source-span.js';

export const optionDirectiveCstParser: Parser<TokenKind, OptionDirectiveCst> =
  apply(
    seq(
      richStr('option'),
      richTok(TokenKind.StringLiteral),
      richTok(TokenKind.StringLiteral),
      metadataCstParser,
    ),
    ([keywordToken, nameToken, valueToken, metadata], range) => ({
      type: 'option',
      keywordToken,
      nameToken,
      valueToken,
      metadata,
      span: spanFromRange(range),
    }),
  );
