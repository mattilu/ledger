import { SourcePosition } from '../parsing/source-position.js';

export interface SourceContext extends SourcePosition {
  readonly filePath: string;
}

export function makeSourceContext(
  filePath: string,
  srcPos: SourcePosition,
): SourceContext {
  return { ...srcPos, filePath };
}
