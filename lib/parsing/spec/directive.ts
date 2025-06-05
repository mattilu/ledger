import { SourcePosition } from '../source-position.js';
import { BalanceDirectiveSpec } from './directives/balance.js';
import { CloseDirectiveSpec } from './directives/close.js';
import { LoadDirectiveSpec } from './directives/load.js';
import { OpenDirectiveSpec } from './directives/open.js';
import { OptionDirectiveSpec } from './directives/option.js';
import { TransactionDirectiveSpec } from './directives/transaction.js';
import { MetadataSpec } from './metadata.js';

export interface DirectiveCommonSpec<T extends string> {
  readonly type: T;
  readonly meta: MetadataSpec;
  readonly srcPos: SourcePosition;
}

export type DirectiveSpec =
  | BalanceDirectiveSpec
  | CloseDirectiveSpec
  | LoadDirectiveSpec
  | OpenDirectiveSpec
  | OptionDirectiveSpec
  | TransactionDirectiveSpec;
