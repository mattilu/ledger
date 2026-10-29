import { DirectiveCommon } from '../directive.js';
import { AccountMap } from '../ledger.js';

export interface CloseDirective extends DirectiveCommon<'close'> {
  readonly account: string;
  readonly accountMap: AccountMap;
}
