import { SourcePosition } from '../source-position.js';
import { LoadDirectiveSpec } from './directives/load.js';
import { OpenDirectiveSpec } from './directives/open.js';
import { OptionDirectiveSpec } from './directives/option.js';
import { TransactionDirectiveSpec } from './directives/transaction.js';

export interface DirectiveCommonSpec<T extends string> {
  readonly type: T;
  readonly srcPos: SourcePosition;
}

export type DirectiveSpec =
  | LoadDirectiveSpec
  | OpenDirectiveSpec
  | OptionDirectiveSpec
  | TransactionDirectiveSpec;
