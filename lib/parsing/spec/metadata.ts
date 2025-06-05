import { ExactNumberType } from 'exactnumber';
import { Map } from 'immutable';

import { Amount } from '../../core/amount.js';
import { DateSpec } from './date.js';

export type MetadataValueSpec = Readonly<
  | { type: 'string'; value: string }
  | { type: 'account'; value: string }
  | { type: 'currency'; value: string }
  | { type: 'date'; value: DateSpec }
  | { type: 'number'; value: ExactNumberType }
  | { type: 'amount'; value: Amount }
>;

export type MetadataSpec = Map<string, MetadataValueSpec>;
