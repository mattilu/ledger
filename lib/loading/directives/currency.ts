import { DatedDirectiveCommon } from '../directive.js';

export interface CurrencyDirective extends DatedDirectiveCommon<'currency'> {
  readonly currency: string;
}
