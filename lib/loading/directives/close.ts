import { DatedDirectiveCommon } from '../directive.js';
import { AccountMap } from '../ledger.js';

export interface CloseDirective extends DatedDirectiveCommon<'close'> {
  readonly account: string;
  readonly accountMap: AccountMap;
}
