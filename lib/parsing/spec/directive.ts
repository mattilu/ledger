import { SourcePosition } from '../source-position.js';
import { OpenDirectiveSpec } from './directives/open.js';
import { TransactionDirectiveSpec } from './directives/transaction.js';

export interface DirectiveCommonSpec<T extends string> {
  readonly type: T;
  readonly srcPos: SourcePosition;
}

export type DirectiveSpec = OpenDirectiveSpec | TransactionDirectiveSpec;
