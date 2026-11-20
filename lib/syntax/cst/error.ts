import { RichToken } from '../token.js';
import { CstNodeCommon } from './common.js';

export interface ErrorCst extends CstNodeCommon {
  readonly type: 'error';
  readonly tokens: readonly RichToken[];
  readonly message: string;
  readonly errorPos: { readonly row: number; readonly col: number };
}
