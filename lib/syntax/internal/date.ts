import { apply, opt_sc, Parser, seq } from 'typescript-parsec';

import { DateCst } from '../cst/date.js';
import { TokenKind } from '../token.js';
import { richTok } from './primitives.js';
import { spanFromRange } from './source-span.js';

export const dateCstParser: Parser<TokenKind, DateCst> = apply(
  seq(
    richTok(TokenKind.DateLiteral),
    opt_sc(
      seq(
        richTok(TokenKind.TimeLiteral),
        opt_sc(richTok(TokenKind.TimeZoneLiteral)),
      ),
    ),
  ),
  ([dateToken, timeAndTimezone], range): DateCst => ({
    dateToken,
    timeToken: timeAndTimezone ? timeAndTimezone[0] : null,
    timezoneToken: timeAndTimezone ? (timeAndTimezone[1] ?? null) : null,
    span: spanFromRange(range),
  }),
);
