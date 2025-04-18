import { apply, opt_sc, seq, tok } from 'typescript-parsec';

import { DateSpec } from '../spec/date.js';
import { TokenKind } from './tokenizer.js';

export const dateParser = apply(
  seq(
    tok(TokenKind.DateLiteral),
    opt_sc(
      seq(tok(TokenKind.TimeLiteral), opt_sc(tok(TokenKind.TimeZoneLiteral))),
    ),
  ),
  ([dateToken, timeAndTimezoneToken]): DateSpec => {
    const time = timeAndTimezoneToken ? timeAndTimezoneToken[0] : null;
    const timezone = timeAndTimezoneToken ? timeAndTimezoneToken[1] : null;
    return {
      date: dateToken.text,
      time: time?.text ?? null,
      timezone: timezone?.text ?? null,
    };
  },
);
