import { Token } from 'typescript-parsec';

import { SourcePosition } from '../source-position.js';

export function makeSourcePosition<T>(
  tokenRange: [Token<T> | undefined, Token<T> | undefined],
): SourcePosition {
  return {
    row: tokenRange[0]?.pos.rowBegin ?? 0,
    col: tokenRange[0]?.pos.columnBegin ?? 0,
  };
}
