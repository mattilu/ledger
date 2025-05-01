import {
  alt_sc,
  apply,
  list_sc,
  opt_sc,
  rep_sc,
  seq,
  tok,
} from 'typescript-parsec';

import {
  CostSpec,
  PostingSpec,
  TransactionDirectiveSpec,
} from '../../spec/directives/transaction.js';
import { accountParser } from '../account.js';
import { amountParser } from '../amount.js';
import { dateParser } from '../date.js';
import { makeSourcePosition } from '../source-position.js';
import { stringParser } from '../string.js';
import { TokenKind } from '../tokenizer.js';

const costSpecContentParser = apply(
  list_sc(amountParser, tok(TokenKind.Comma)),
  (amounts): Omit<CostSpec, 'kind'> => ({ amounts }),
);

const costSpecParser = apply(
  alt_sc(
    seq(
      tok(TokenKind.OpenBrace),
      opt_sc(costSpecContentParser),
      tok(TokenKind.CloseBrace),
    ),
    seq(
      tok(TokenKind.DoubleOpenBrace),
      opt_sc(costSpecContentParser),
      tok(TokenKind.DoubleCloseBrace),
    ),
  ),
  ([token, costSpec]): CostSpec => {
    return {
      kind: token.kind === TokenKind.OpenBrace ? 'per-unit' : 'total',
      amounts: costSpec?.amounts ?? [],
    };
  },
);

const postingParser = apply(
  seq(accountParser, opt_sc(amountParser), opt_sc(costSpecParser)),
  ([account, amount, costSpec]): PostingSpec => ({
    account,
    amount: amount ?? null,
    costSpec: costSpec ?? null,
  }),
);

export const transactionDirectiveParser = apply(
  seq(dateParser, tok(TokenKind.Star), stringParser, rep_sc(postingParser)),
  ([date, , description, postings], tokenRange): TransactionDirectiveSpec => ({
    type: 'transaction',
    date,
    description,
    postings,
    srcPos: makeSourcePosition(tokenRange),
  }),
);
