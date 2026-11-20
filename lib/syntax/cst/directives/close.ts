import { RichToken } from '../../token.js';
import { DateCst } from '../date.js';
import { DirectiveCommonCst } from '../directive.js';

export interface CloseDirectiveCst extends DirectiveCommonCst<'close'> {
  readonly date: DateCst;
  readonly keywordToken: RichToken;
  readonly accountToken: RichToken;
}
