import { apply, Parser, seq } from 'typescript-parsec';

import { AccountRuleDirectiveCst } from '../../cst/directives/account-rule.js';
import { TokenKind } from '../../token.js';
import { ruleBlockCstParser } from '../account-choice.js';
import { metadataCstParser } from '../metadata.js';
import { richStr, richTok } from '../primitives.js';
import { spanFromRange } from '../source-span.js';

export const accountRuleDirectiveCstParser: Parser<
  TokenKind,
  AccountRuleDirectiveCst
> = apply(
  seq(
    richStr('account-rule'),
    richTok(TokenKind.StringLiteral),
    ruleBlockCstParser,
    metadataCstParser,
  ),
  ([keywordToken, nameToken, block, metadata], range) => ({
    type: 'account-rule',
    keywordToken,
    nameToken,
    block,
    metadata,
    span: spanFromRange(range),
  }),
);
