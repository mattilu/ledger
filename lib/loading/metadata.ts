import { ExactNumberType } from 'exactnumber';
import { Map } from 'immutable';

import { Amount } from '../core/amount.js';

export type MetadataValue = Readonly<
  | { type: 'string'; value: string }
  | { type: 'account'; value: string }
  | { type: 'currency'; value: string }
  | { type: 'date'; value: Date }
  | { type: 'number'; value: ExactNumberType }
  | { type: 'amount'; value: Amount }
>;

export type Metadata = Map<string, MetadataValue>;
