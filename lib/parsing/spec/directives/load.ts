import { DirectiveCommonSpec } from '../directive.js';

/**
 * Loads content from another ledger file.
 *
 * Paths are considered relative to the calling file's containing directory.
 */
export interface LoadDirectiveSpec extends DirectiveCommonSpec<'load'> {
  readonly path: string;
}
