import {
  alt_sc,
  apply,
  list_sc,
  opt_sc,
  Parser,
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
import { currencyParser } from '../currency.js';
import { dateParser } from '../date.js';
import { metadataParser } from '../metadata.js';
import { makeSourcePosition } from '../source-position.js';
import { stringParser } from '../string.js';
import { TokenKind } from '../tokenizer.js';

const tagged = <T, Tag extends string>(
  parser: Parser<TokenKind, T>,
  tag: Tag,
) => apply(parser, value => ({ tag, value }));

const costSpecContentParser = apply(
  list_sc(
    alt_sc(
      tagged(amountParser, 'amount'),
      tagged(currencyParser, 'currency'),
      tagged(dateParser, 'date'),
      tagged(stringParser, 'tag'),
    ),
    tok(TokenKind.Comma),
  ),
  (items): Omit<CostSpec, 'kind'> => ({
    amounts: items.filter(x => x.tag === 'amount').map(x => x.value),
    currencies: items.filter(x => x.tag === 'currency').map(x => x.value),
    dates: items.filter(x => x.tag === 'date').map(x => x.value),
    tags: items.filter(x => x.tag === 'tag').map(x => x.value),
  }),
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
      currencies: costSpec?.currencies ?? [],
      dates: costSpec?.dates ?? [],
      tags: costSpec?.tags ?? [],
    };
  },
);

const postingParser = apply(
  seq(
    opt_sc(alt_sc(tok(TokenKind.Times), tok(TokenKind.ExclamationMark))),
    accountParser,
    opt_sc(amountParser),
    opt_sc(costSpecParser),
    metadataParser,
  ),
  ([flag, account, amount, costSpec, meta]): PostingSpec => ({
    account,
    flag: flag?.text ?? null,
    amount: amount ?? null,
    costSpec: costSpec ?? null,
    meta,
  }),
);

export const transactionDirectiveParser = apply(
  seq(
    dateParser,
    alt_sc(
      tok(TokenKind.KEYWORD_txn),
      tok(TokenKind.Times),
      tok(TokenKind.ExclamationMark),
    ),
    stringParser,
    metadataParser,
    rep_sc(postingParser),
  ),
  (
    [date, token, description, meta, postings],
    tokenRange,
  ): TransactionDirectiveSpec => ({
    type: 'transaction',
    date,
    description,
    flag: token.kind === TokenKind.ExclamationMark ? '!' : '*',
    meta,
    postings,
    srcPos: makeSourcePosition(tokenRange),
  }),
);
