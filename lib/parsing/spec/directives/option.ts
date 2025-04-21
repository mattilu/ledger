import { DirectiveCommonSpec } from '../directive.js';

export interface OptionDirectiveSpec extends DirectiveCommonSpec<'option'> {
  readonly optionName: string;
  readonly optionValue: string;
}
