import { DirectiveCommon } from '../directive.js';

export interface CloseDirective extends DirectiveCommon<'close'> {
  readonly account: string;
}
