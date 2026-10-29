import { NormalBalanceSide } from '../../core/account.js';
import { DirectiveCommon } from '../directive.js';
import { AccountMap } from '../ledger.js';

export interface OpenDirective extends DirectiveCommon<'open'> {
  readonly account: string;
  readonly currencies: readonly string[];
  readonly normalBalanceSide?: NormalBalanceSide;
  readonly accountMap: AccountMap;
}
