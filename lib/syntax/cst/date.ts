import { RichToken } from '../token.js';
import { CstNodeCommon } from './common.js';

export interface DateCst extends CstNodeCommon {
  readonly dateToken: RichToken;
  readonly timeToken: RichToken | null;
  readonly timezoneToken: RichToken | null;
}
