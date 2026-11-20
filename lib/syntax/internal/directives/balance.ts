import { apply, opt_sc, Parser, seq } from 'typescript-parsec';

import {
  BalanceDirectiveCst,
  BalanceEntryCst,
} from '../../cst/directives/balance.js';
import { TokenKind } from '../../token.js';
import { amountCstParser } from '../amount.js';
import { rep_sc } from '../combinators.js';
import { dateCstParser } from '../date.js';
import { expressionCstParser } from '../expression.js';
import { metadataCstParser } from '../metadata.js';
import { richStr, richTok } from '../primitives.js';
import { spanFromRange } from '../source-span.js';

export const balanceEntryCstParser: Parser<TokenKind, BalanceEntryCst> = apply(
  seq(
    richTok(TokenKind.Account),
    amountCstParser,
    opt_sc(seq(richTok(TokenKind.Tilde), expressionCstParser)),
  ),
  ([accountToken, amount, approx], range): BalanceEntryCst => ({
    type: 'balance-entry',
    accountToken,
    amount,
    approx:
      approx === undefined
        ? null
        : { tildeToken: approx[0], tolerance: approx[1] },
    span: spanFromRange(range),
  }),
);

/**
 * Builds a `balance` directive CST parser parameterized over `entryParser`.
 *
 * Allows strict and error-recovering parsers to share one grammar definition.
 *
 * @param entryParser Parser for individual balance assertion entries.
 * @returns A parser producing `BalanceDirectiveCst<TBalanceEntry>`.
 */
export function makeBalanceDirectiveCstParser<TBalanceEntry>(
  entryParser: Parser<TokenKind, TBalanceEntry>,
): Parser<TokenKind, BalanceDirectiveCst<TBalanceEntry>> {
  return apply(
    seq(
      dateCstParser,
      richStr('balance'),
      metadataCstParser,
      rep_sc(entryParser),
    ),
    ([date, keywordToken, metadata, balances], range) => ({
      type: 'balance',
      date,
      keywordToken,
      metadata,
      balances,
      span: spanFromRange(range),
    }),
  );
}

export const balanceDirectiveCstParser: Parser<TokenKind, BalanceDirectiveCst> =
  makeBalanceDirectiveCstParser(balanceEntryCstParser);
