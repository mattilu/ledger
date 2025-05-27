import { DirectiveCommon } from '../directive.js';

export interface OpenDirective extends DirectiveCommon<'open'> {
  readonly account: string;
  readonly currencies: readonly string[];
}
