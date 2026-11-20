import { RichToken } from '../../token.js';
import { DirectiveCommonCst } from '../directive.js';

export interface LoadDirectiveCst extends DirectiveCommonCst<'load'> {
  readonly keywordToken: RichToken;
  readonly pathToken: RichToken;
}
