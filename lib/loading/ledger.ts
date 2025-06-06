import { Map } from 'immutable';

import { Directive } from './directive.js';
import { CurrencyDirective } from './directives/currency.js';

export interface Ledger {
  readonly directives: readonly Directive[];
  readonly currencyMap: Map<string, CurrencyDirective>;
}
