import { Map } from 'immutable';

import { BalanceDirective } from './directives/balance.js';
import { CloseDirective } from './directives/close.js';
import { OpenDirective } from './directives/open.js';
import { PriceDirective } from './directives/price.js';
import { TransactionDirective } from './directives/transaction.js';
import { Metadata } from './metadata.js';
import { SourceContext } from './source-context.js';

export interface DirectiveCommon<T extends string> {
  readonly type: T;
  readonly meta: Metadata;
  readonly srcCtx: SourceContext;
  readonly optionMap: Map<string, string>;
}

export interface DatedDirectiveCommon<
  T extends string,
> extends DirectiveCommon<T> {
  readonly date: Date;
}

export type Directive =
  | BalanceDirective
  | CloseDirective
  | OpenDirective
  | PriceDirective
  | TransactionDirective;
