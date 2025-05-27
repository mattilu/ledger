import { DateSpec } from '../date.js';
import { DirectiveCommonSpec } from '../directive.js';

export interface CloseDirectiveSpec extends DirectiveCommonSpec<'close'> {
  readonly date: DateSpec;
  readonly account: string;
}
