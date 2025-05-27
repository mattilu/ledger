import { BalanceDirective } from './directives/balance.js';
import { OpenDirective } from './directives/open.js';
import { TransactionDirective } from './directives/transaction.js';
import { SourceContext } from './source-context.js';

export interface DirectiveCommon<T extends string> {
  readonly type: T;
  readonly date: Date;
  readonly srcCtx: SourceContext;
}

export type Directive = BalanceDirective | OpenDirective | TransactionDirective;
