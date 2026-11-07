import { ConditionExpression } from '../condition.js';
import { DirectiveCommonSpec } from '../directive.js';

export type AccountChoiceRule =
  | {
      readonly type: 'when';
      readonly condition: ConditionExpression;
      readonly account: string;
    }
  | { readonly type: 'otherwise'; readonly account: string };

export interface AccountRuleDirectiveSpec extends DirectiveCommonSpec<'account-rule'> {
  readonly name: string;
  readonly rules: readonly AccountChoiceRule[];
}
