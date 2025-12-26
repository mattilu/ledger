import { Amount } from '../../core/amount.js';
import { DirectiveCommon } from '../directive.js';

export interface PriceDirective extends DirectiveCommon<'price'> {
  readonly currency: string;
  readonly price: Amount;
}
