import { AmountSpec } from '../amount.js';
import { DateSpec } from '../date.js';
import { DirectiveCommonSpec } from '../directive.js';

export interface PriceDirectiveSpec extends DirectiveCommonSpec<'price'> {
  readonly date: DateSpec;
  readonly currency: string;
  readonly price: AmountSpec;
}
