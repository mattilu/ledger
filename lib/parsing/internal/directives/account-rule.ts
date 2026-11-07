import { apply, seq, str } from 'typescript-parsec';

import { AccountRuleDirectiveSpec } from '../../spec/directives/account-rule.js';
import { accountChoiceRuleBlockParser } from '../account-choice.js';
import { metadataParser } from '../metadata.js';
import { makeSourcePosition } from '../source-position.js';
import { stringParser } from '../string.js';

export const accountRuleDirectiveParser = apply(
  seq(
    str('account-rule'),
    stringParser,
    accountChoiceRuleBlockParser,
    metadataParser,
  ),
  ([, name, rules, meta], tokenRange): AccountRuleDirectiveSpec => ({
    type: 'account-rule',
    name,
    rules,
    meta,
    srcPos: makeSourcePosition(tokenRange),
  }),
);
