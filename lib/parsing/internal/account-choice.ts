import {
  alt_sc,
  apply,
  kright,
  list_sc,
  opt_sc,
  seq,
  str,
  tok,
} from 'typescript-parsec';

import {
  AccountChoiceOtherwiseOutcome,
  AccountChoiceOutcome,
  AccountChoiceRule,
} from '../spec/directives/account-rule.js';
import { accountParser } from './account.js';
import { conditionParser } from './condition.js';
import { stringParser } from './string.js';
import { TokenKind } from './tokenizer.js';

const accountOutcomeParser = apply(
  accountParser,
  (account): AccountChoiceOtherwiseOutcome => ({ type: 'account', account }),
);

const failOutcomeParser = apply(
  kright(str<TokenKind>('fail'), opt_sc(stringParser)),
  (message): AccountChoiceOtherwiseOutcome => ({
    type: 'fail',
    message: message ?? null,
  }),
);

const otherwiseOutcomeParser = alt_sc(accountOutcomeParser, failOutcomeParser);

const whenOutcomeParser = alt_sc(
  otherwiseOutcomeParser,
  apply(str('break'), (): AccountChoiceOutcome => ({ type: 'break' })),
);

const whenClauseParser = apply(
  seq(str('when'), conditionParser, tok(TokenKind.Colon), whenOutcomeParser),
  ([, condition, , outcome]): AccountChoiceRule => ({
    type: 'when',
    condition,
    outcome,
  }),
);

const otherwiseClauseParser = apply(
  seq(str('otherwise'), tok(TokenKind.Colon), otherwiseOutcomeParser),
  ([, , outcome]): AccountChoiceRule => ({ type: 'otherwise', outcome }),
);

export const accountChoiceRuleBlockParser = apply(
  seq(
    tok(TokenKind.OpenBrace),
    list_sc(whenClauseParser, tok(TokenKind.Comma)),
    opt_sc(kright(tok(TokenKind.Comma), otherwiseClauseParser)),
    opt_sc(tok(TokenKind.Comma)),
    tok(TokenKind.CloseBrace),
  ),
  ([, when, otherwise]): readonly AccountChoiceRule[] => [
    ...when,
    ...(otherwise ? [otherwise] : []),
  ],
);
