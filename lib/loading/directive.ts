import { Map } from 'immutable';

import { BalanceDirective } from './directives/balance.js';
import { CloseDirective } from './directives/close.js';
import { OpenDirective } from './directives/open.js';
import { TransactionDirective } from './directives/transaction.js';
import { Metadata } from './metadata.js';
import { SourceContext } from './source-context.js';

export interface DirectiveCommon<T extends string> {
  readonly type: T;
  readonly date: Date;
  readonly meta: Metadata;
  readonly srcCtx: SourceContext;
  readonly optionMap: Map<string, string>;
}

export type Directive =
  | BalanceDirective
  | CloseDirective
  | OpenDirective
  | TransactionDirective;
