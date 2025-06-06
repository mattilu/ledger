import { DirectiveCommon } from '../directive.js';

export interface CurrencyDirective extends DirectiveCommon<'currency'> {
  readonly currency: string;
}
