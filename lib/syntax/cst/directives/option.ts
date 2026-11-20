import { RichToken } from '../../token.js';
import { DirectiveCommonCst } from '../directive.js';

export interface OptionDirectiveCst extends DirectiveCommonCst<'option'> {
  readonly keywordToken: RichToken;
  readonly nameToken: RichToken;
  readonly valueToken: RichToken;
}
