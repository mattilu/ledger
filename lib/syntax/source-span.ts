export interface SourcePoint {
  /** 0-based UTF-16 code unit offset in the source string. */
  readonly offset: number;
  /** 1-based line number. */
  readonly row: number;
  /** 1-based column number. */
  readonly col: number;
}

export interface SourceSpan {
  readonly start: SourcePoint;
  readonly end: SourcePoint;
}
