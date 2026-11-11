import {
  apply,
  kright,
  list_sc,
  opt_sc,
  seq,
  str,
  tok,
} from 'typescript-parsec';

import { AccountChoiceRule } from '../spec/directives/account-rule.js';
import { accountParser } from './account.js';
import { conditionParser } from './condition.js';
import { TokenKind } from './tokenizer.js';

const whenClauseParser = apply(
  seq(str('when'), conditionParser, tok(TokenKind.Colon), accountParser),
  ([, condition, , account]): AccountChoiceRule => ({
    type: 'when',
    condition,
    account,
  }),
);

const otherwiseClauseParser = apply(
  seq(str('otherwise'), tok(TokenKind.Colon), accountParser),
  ([, , account]): AccountChoiceRule => ({ type: 'otherwise', account }),
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
