import { RichToken } from '../../token.js';
import { AmountCst } from '../amount.js';
import { DateCst } from '../date.js';
import { DirectiveCommonCst } from '../directive.js';

export interface PriceDirectiveCst extends DirectiveCommonCst<'price'> {
  readonly date: DateCst;
  readonly keywordToken: RichToken;
  readonly currencyToken: RichToken;
  readonly price: AmountCst;
}
