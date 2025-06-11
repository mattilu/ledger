import { DateSpec } from '../date.js';
import { DirectiveCommonSpec } from '../directive.js';

// Note: Also allow `commodity` for compatibility with beancount.
export interface CurrencyDirectiveSpec
  extends DirectiveCommonSpec<'currency' | 'commodity'> {
  readonly date: DateSpec;
  readonly currency: string;
}
