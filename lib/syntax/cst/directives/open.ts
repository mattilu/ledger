import { RichToken } from '../../token.js';
import { DateCst } from '../date.js';
import { DirectiveCommonCst } from '../directive.js';

export interface OpenDirectiveCst extends DirectiveCommonCst<'open'> {
  readonly date: DateCst;
  readonly keywordToken: RichToken;
  readonly accountToken: RichToken;
  readonly currencyTokens: readonly RichToken[];
}
