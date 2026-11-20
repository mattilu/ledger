import { RichToken } from '../token.js';
import { AmountCst } from './amount.js';
import { CstNodeCommon } from './common.js';
import { DateCst } from './date.js';
import { ExpressionCst } from './expression.js';

export type MetadataValueCst =
  | { readonly type: 'string'; readonly token: RichToken }
  | { readonly type: 'account'; readonly token: RichToken }
  | { readonly type: 'currency'; readonly token: RichToken }
  | { readonly type: 'date'; readonly date: DateCst }
  | { readonly type: 'amount'; readonly amount: AmountCst }
  | { readonly type: 'number'; readonly expr: ExpressionCst };

export interface MetadataEntryCst extends CstNodeCommon {
  readonly keyToken: RichToken;
  readonly colonToken: RichToken;
  readonly value: MetadataValueCst;
}
