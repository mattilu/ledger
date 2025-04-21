import { BookedLedger } from '../booking/ledger.js';

export interface Report {
  run(ledger: BookedLedger): string;
}
