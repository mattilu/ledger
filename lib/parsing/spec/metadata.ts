import { Map } from 'immutable';

import { AmountSpec } from './amount.js';
import { DateSpec } from './date.js';
import { Expression } from './expression.js';

export type MetadataValueSpec = Readonly<
  | { type: 'string'; value: string }
  | { type: 'account'; value: string }
  | { type: 'currency'; value: string }
  | { type: 'date'; value: DateSpec }
  | { type: 'number'; value: Expression }
  | { type: 'amount'; value: AmountSpec }
>;

export type MetadataSpec = Map<string, MetadataValueSpec>;
