import { ConditionExpression } from '../condition.js';
import { DirectiveCommonSpec } from '../directive.js';

export type AccountChoiceOutcome =
  | { readonly type: 'account'; readonly account: string }
  | { readonly type: 'fail'; readonly message: string | null }
  | { readonly type: 'break' };

export type AccountChoiceOtherwiseOutcome = Exclude<
  AccountChoiceOutcome,
  { readonly type: 'break' }
>;

export type AccountChoiceRule =
  | {
      readonly type: 'when';
      readonly condition: ConditionExpression;
      readonly outcome: AccountChoiceOutcome;
    }
  | {
      readonly type: 'otherwise';
      readonly outcome: AccountChoiceOtherwiseOutcome;
    };

export interface AccountRuleDirectiveSpec extends DirectiveCommonSpec<'account-rule'> {
  readonly name: string;
  readonly rules: readonly AccountChoiceRule[];
}
