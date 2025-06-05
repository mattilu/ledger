import { apply, seq } from 'typescript-parsec';

import { AmountSpec } from '../spec/amount.js';
import { currencyParser } from './currency.js';
import { expressionParser } from './expression.js';

export const amountParser = apply(
  seq(expressionParser, currencyParser),
  ([amount, currency]): AmountSpec => ({ amount, currency }),
);
