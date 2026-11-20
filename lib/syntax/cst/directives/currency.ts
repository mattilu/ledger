import { RichToken } from '../../token.js';
import { DateCst } from '../date.js';
import { DirectiveCommonCst } from '../directive.js';

export interface CurrencyDirectiveCst extends DirectiveCommonCst<
  'currency' | 'commodity'
> {
  readonly date: DateCst;
  readonly keywordToken: RichToken;
  readonly currencyToken: RichToken;
}
