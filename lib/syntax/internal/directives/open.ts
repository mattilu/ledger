import { apply, Parser, seq } from 'typescript-parsec';

import { OpenDirectiveCst } from '../../cst/directives/open.js';
import { TokenKind } from '../../token.js';
import { rep_sc } from '../combinators.js';
import { dateCstParser } from '../date.js';
import { metadataCstParser } from '../metadata.js';
import { richStr, richTok } from '../primitives.js';
import { spanFromRange } from '../source-span.js';

export const openDirectiveCstParser: Parser<TokenKind, OpenDirectiveCst> =
  apply(
    seq(
      dateCstParser,
      richStr('open'),
      richTok(TokenKind.Account),
      rep_sc(richTok(TokenKind.Currency)),
      metadataCstParser,
    ),
    ([date, keywordToken, accountToken, currencyTokens, metadata], range) => ({
      type: 'open',
      date,
      keywordToken,
      accountToken,
      currencyTokens,
      metadata,
      span: spanFromRange(range),
    }),
  );
