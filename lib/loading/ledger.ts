import { Map } from 'immutable';

import { SignConvention } from '../core/sign-convention.js';
import { Directive } from './directive.js';
import { CloseDirective } from './directives/close.js';
import { CurrencyDirective } from './directives/currency.js';
import { OpenDirective } from './directives/open.js';

export type AccountMapValue = {
  readonly open?: Omit<OpenDirective, 'accountMap'>;
  readonly close?: Omit<CloseDirective, 'accountMap'>;
};

export type AccountMap = Map<string, AccountMapValue>;

export interface Ledger {
  readonly directives: readonly Directive[];
  readonly currencyMap: Map<string, CurrencyDirective>;
  readonly accountMap: AccountMap;
  readonly signConvention: SignConvention;
}
