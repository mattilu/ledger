import { alt_sc, apply, opt_sc, Parser, seq } from 'typescript-parsec';

import {
  AccountChoicePostingCst,
  AccountChoiceTargetCst,
  AccountPostingCst,
  CostItemCst,
  CostItemValueCst,
  CostSpecCst,
  PostingCst,
  PriceSpecCst,
  TransactionDirectiveCst,
} from '../../cst/directives/transaction.js';
import { RichToken, TokenKind } from '../../token.js';
import { ruleBlockCstParser } from '../account-choice.js';
import { amountCstParser } from '../amount.js';
import { rep_sc } from '../combinators.js';
import { dateCstParser } from '../date.js';
import { metadataCstParser } from '../metadata.js';
import { richStr, richTok } from '../primitives.js';
import { spanFromRange } from '../source-span.js';

const costItemValueCstParser: Parser<
  TokenKind,
  { readonly value: CostItemValueCst; readonly span: CostItemCst['span'] }
> = alt_sc(
  apply(amountCstParser, (amount, range) => ({
    value: { kind: 'amount' as const, amount },
    span: spanFromRange(range),
  })),
  apply(richTok(TokenKind.Currency), (token, range) => ({
    value: { kind: 'currency' as const, token },
    span: spanFromRange(range),
  })),
  apply(dateCstParser, (date, range) => ({
    value: { kind: 'date' as const, date },
    span: spanFromRange(range),
  })),
  apply(richTok(TokenKind.StringLiteral), (token, range) => ({
    value: { kind: 'tag' as const, token },
    span: spanFromRange(range),
  })),
);

const costSpecItemsCstParser: Parser<TokenKind, readonly CostItemCst[]> = apply(
  seq(
    costItemValueCstParser,
    rep_sc(seq(richTok(TokenKind.Comma), costItemValueCstParser)),
  ),
  ([first, rest]): readonly CostItemCst[] => {
    const rawItems = [first, ...rest.map(([, item]) => item)];
    const commas: (RichToken | null)[] = rest.map(([comma]) => comma);
    return rawItems.map((item, idx) => {
      const commaToken = idx < commas.length ? commas[idx] : null;
      return {
        value: item.value,
        commaToken,
        span: commaToken
          ? { start: item.span.start, end: commaToken.span.end }
          : item.span,
      };
    });
  },
);

const costSpecCstParser: Parser<TokenKind, CostSpecCst> = apply(
  alt_sc(
    seq(
      richTok(TokenKind.OpenBrace),
      opt_sc(costSpecItemsCstParser),
      richTok(TokenKind.CloseBrace),
    ),
    seq(
      richTok(TokenKind.DoubleOpenBrace),
      opt_sc(costSpecItemsCstParser),
      richTok(TokenKind.DoubleCloseBrace),
    ),
  ),
  ([openToken, items, closeToken], range): CostSpecCst => ({
    kind: openToken.kind === TokenKind.OpenBrace ? 'per-unit' : 'total',
    openToken,
    items: items ?? [],
    closeToken,
    span: spanFromRange(range),
  }),
);

const priceSpecCstParser: Parser<TokenKind, PriceSpecCst> = apply(
  seq(
    alt_sc(richTok(TokenKind.At), richTok(TokenKind.DoubleAt)),
    amountCstParser,
  ),
  ([opToken, amount], range): PriceSpecCst => ({
    kind: opToken.kind === TokenKind.At ? 'per-unit' : 'total',
    opToken,
    amount,
    span: spanFromRange(range),
  }),
);

const postingFlagParser = opt_sc(
  alt_sc(richTok(TokenKind.Times), richTok(TokenKind.ExclamationMark)),
);

const accountPostingCstParser: Parser<TokenKind, AccountPostingCst> = apply(
  seq(
    postingFlagParser,
    richTok(TokenKind.Account),
    opt_sc(amountCstParser),
    opt_sc(costSpecCstParser),
    opt_sc(priceSpecCstParser),
    metadataCstParser,
  ),
  (
    [flagToken, accountToken, amount, costSpec, priceSpec, metadata],
    range,
  ): AccountPostingCst => ({
    type: 'account-posting',
    flagToken: flagToken ?? null,
    accountToken,
    amount: amount ?? null,
    costSpec: costSpec ?? null,
    priceSpec: priceSpec ?? null,
    metadata,
    span: spanFromRange(range),
  }),
);

const accountChoiceTargetCstParser: Parser<TokenKind, AccountChoiceTargetCst> =
  alt_sc(
    apply(ruleBlockCstParser, (block): AccountChoiceTargetCst => ({
      type: 'inline',
      block,
    })),
    apply(
      richTok(TokenKind.StringLiteral),
      (nameToken): AccountChoiceTargetCst => ({ type: 'ref', nameToken }),
    ),
  );

const accountChoicePostingCstParser: Parser<
  TokenKind,
  AccountChoicePostingCst
> = apply(
  seq(
    postingFlagParser,
    richStr('choose'),
    richStr('account'),
    accountChoiceTargetCstParser,
    metadataCstParser,
  ),
  (
    [flagToken, chooseToken, accountKeywordToken, target, metadata],
    range,
  ): AccountChoicePostingCst => ({
    type: 'account-choice-posting',
    flagToken: flagToken ?? null,
    chooseToken,
    accountKeywordToken,
    target,
    metadata,
    span: spanFromRange(range),
  }),
);

export const postingCstParser: Parser<TokenKind, PostingCst> = alt_sc(
  accountChoicePostingCstParser,
  accountPostingCstParser,
);

/**
 * Builds a transaction directive CST parser parameterized over `itemParser`.
 *
 * Allows strict and error-recovering parsers to share one grammar definition.
 *
 * @param itemParser Parser for individual transaction postings.
 * @returns A parser producing `TransactionDirectiveCst<TPosting>`.
 */
export function makeTransactionDirectiveCstParser<TPosting>(
  itemParser: Parser<TokenKind, TPosting>,
): Parser<TokenKind, TransactionDirectiveCst<TPosting>> {
  return apply(
    seq(
      dateCstParser,
      alt_sc(
        richStr('txn'),
        richTok(TokenKind.Times),
        richTok(TokenKind.ExclamationMark),
      ),
      richTok(TokenKind.StringLiteral),
      metadataCstParser,
      rep_sc(itemParser),
    ),
    (
      [date, flagToken, descriptionToken, metadata, postings],
      range,
    ): TransactionDirectiveCst<TPosting> => ({
      type: 'transaction',
      date,
      flagToken,
      descriptionToken,
      metadata,
      postings,
      span: spanFromRange(range),
    }),
  );
}

export const transactionDirectiveCstParser: Parser<
  TokenKind,
  TransactionDirectiveCst
> = makeTransactionDirectiveCstParser(postingCstParser);
