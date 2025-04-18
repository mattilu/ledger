import { apply, seq } from 'typescript-parsec';

import { Amount } from '../../core/amount.js';
import { currencyParser } from './currency.js';
import { numberParser } from './number.js';

export const amountParser = apply(
  seq(numberParser, currencyParser),
  ([amount, currency]) => new Amount(amount, currency),
);
