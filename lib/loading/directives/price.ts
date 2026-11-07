import { Amount } from '../../core/amount.js';
import { DatedDirectiveCommon } from '../directive.js';

export interface PriceDirective extends DatedDirectiveCommon<'price'> {
  readonly currency: string;
  readonly price: Amount;
}
