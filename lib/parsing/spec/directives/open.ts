import { DateSpec } from '../date.js';
import { DirectiveCommonSpec } from '../directive.js';

export interface OpenDirectiveSpec extends DirectiveCommonSpec<'open'> {
  readonly date: DateSpec;
  readonly account: string;
  readonly currencies: readonly string[];
}
