import { Directive } from './directive.js';

export interface Ledger {
  readonly directives: readonly Directive[];
}
