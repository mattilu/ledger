import { RichToken } from '../../token.js';
import { CstNodeCommon } from '../common.js';
import { ConditionExpressionCst } from '../condition.js';
import { DirectiveCommonCst } from '../directive.js';

export type AccountChoiceOtherwiseOutcomeCst =
  | { readonly type: 'account'; readonly accountToken: RichToken }
  | {
      readonly type: 'fail';
      readonly failToken: RichToken;
      readonly messageToken: RichToken | null;
    };

export type AccountChoiceOutcomeCst =
  | AccountChoiceOtherwiseOutcomeCst
  | { readonly type: 'break'; readonly breakToken: RichToken };

export interface WhenClauseCst extends CstNodeCommon {
  readonly type: 'when';
  readonly whenToken: RichToken;
  readonly condition: ConditionExpressionCst;
  readonly colonToken: RichToken;
  readonly outcome: AccountChoiceOutcomeCst;
  readonly commaToken: RichToken | null;
}

export interface OtherwiseClauseCst extends CstNodeCommon {
  readonly type: 'otherwise';
  readonly otherwiseToken: RichToken;
  readonly colonToken: RichToken;
  readonly outcome: AccountChoiceOtherwiseOutcomeCst;
  readonly commaToken: RichToken | null;
}

export type RuleClauseCst = WhenClauseCst | OtherwiseClauseCst;

export interface RuleBlockCst extends CstNodeCommon {
  readonly openBrace: RichToken;
  readonly clauses: readonly RuleClauseCst[];
  readonly closeBrace: RichToken;
}

export interface AccountRuleDirectiveCst extends DirectiveCommonCst<'account-rule'> {
  readonly keywordToken: RichToken;
  readonly nameToken: RichToken;
  readonly block: RuleBlockCst;
}
