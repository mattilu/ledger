import { alt_sc, apply, opt_sc, Parser, seq } from 'typescript-parsec';

import {
  AccountChoiceOtherwiseOutcomeCst,
  AccountChoiceOutcomeCst,
  OtherwiseClauseCst,
  RuleBlockCst,
  RuleClauseCst,
  WhenClauseCst,
} from '../cst/directives/account-rule.js';
import { RichToken, TokenKind } from '../token.js';
import { rep_sc } from './combinators.js';
import { conditionCstParser } from './condition.js';
import { richStr, richTok } from './primitives.js';
import { spanFromRange } from './source-span.js';

const accountOutcomeCstParser: Parser<
  TokenKind,
  AccountChoiceOtherwiseOutcomeCst
> = apply(richTok(TokenKind.Account), accountToken => ({
  type: 'account',
  accountToken,
}));

const failOutcomeCstParser: Parser<
  TokenKind,
  AccountChoiceOtherwiseOutcomeCst
> = apply(
  seq(richStr('fail'), opt_sc(richTok(TokenKind.StringLiteral))),
  ([failToken, messageToken]) => ({
    type: 'fail',
    failToken,
    messageToken: messageToken ?? null,
  }),
);

const otherwiseOutcomeCstParser: Parser<
  TokenKind,
  AccountChoiceOtherwiseOutcomeCst
> = alt_sc(accountOutcomeCstParser, failOutcomeCstParser);

const whenOutcomeCstParser: Parser<TokenKind, AccountChoiceOutcomeCst> = alt_sc(
  otherwiseOutcomeCstParser,
  apply(richStr('break'), breakToken => ({
    type: 'break',
    breakToken,
  })),
);

type BaseWhenClause = Omit<WhenClauseCst, 'commaToken'>;
type BaseOtherwiseClause = Omit<OtherwiseClauseCst, 'commaToken'>;

const whenClauseBaseParser: Parser<TokenKind, BaseWhenClause> = apply(
  seq(
    richStr('when'),
    conditionCstParser,
    richTok(TokenKind.Colon),
    whenOutcomeCstParser,
  ),
  ([whenToken, condition, colonToken, outcome], range): BaseWhenClause => ({
    type: 'when',
    whenToken,
    condition,
    colonToken,
    outcome,
    span: spanFromRange(range),
  }),
);

const otherwiseClauseBaseParser: Parser<TokenKind, BaseOtherwiseClause> = apply(
  seq(
    richStr('otherwise'),
    richTok(TokenKind.Colon),
    otherwiseOutcomeCstParser,
  ),
  ([otherwiseToken, colonToken, outcome], range): BaseOtherwiseClause => ({
    type: 'otherwise',
    otherwiseToken,
    colonToken,
    outcome,
    span: spanFromRange(range),
  }),
);

function attachCommaToWhen(
  clause: BaseWhenClause,
  commaToken: RichToken | null,
): WhenClauseCst {
  return {
    ...clause,
    commaToken,
    span: commaToken
      ? { start: clause.span.start, end: commaToken.span.end }
      : clause.span,
  };
}

function attachCommaToOtherwise(
  clause: BaseOtherwiseClause,
  commaToken: RichToken | null,
): OtherwiseClauseCst {
  return {
    ...clause,
    commaToken,
    span: commaToken
      ? { start: clause.span.start, end: commaToken.span.end }
      : clause.span,
  };
}

export const ruleBlockCstParser: Parser<TokenKind, RuleBlockCst> = apply(
  seq(
    richTok(TokenKind.OpenBrace),
    whenClauseBaseParser,
    rep_sc(seq(richTok(TokenKind.Comma), whenClauseBaseParser)),
    opt_sc(seq(richTok(TokenKind.Comma), otherwiseClauseBaseParser)),
    opt_sc(richTok(TokenKind.Comma)),
    richTok(TokenKind.CloseBrace),
  ),
  (
    [
      openBrace,
      firstWhen,
      restWhens,
      commaAndOtherwise,
      trailingComma,
      closeBrace,
    ],
    range,
  ): RuleBlockCst => {
    const baseWhens: BaseWhenClause[] = [
      firstWhen,
      ...restWhens.map(([, clause]) => clause),
    ];
    const whenSeparatorCommas: (RichToken | null)[] = restWhens.map(
      ([comma]) => comma,
    );

    const clauses: RuleClauseCst[] = [];
    for (let i = 0; i < baseWhens.length; i++) {
      let comma: RichToken | null = null;
      if (i < whenSeparatorCommas.length) {
        comma = whenSeparatorCommas[i];
      } else if (commaAndOtherwise !== undefined) {
        comma = commaAndOtherwise[0];
      } else if (trailingComma !== undefined) {
        comma = trailingComma;
      }
      clauses.push(attachCommaToWhen(baseWhens[i], comma));
    }

    if (commaAndOtherwise !== undefined) {
      clauses.push(
        attachCommaToOtherwise(commaAndOtherwise[1], trailingComma ?? null),
      );
    }

    return {
      openBrace,
      clauses,
      closeBrace,
      span: spanFromRange(range),
    };
  },
);
