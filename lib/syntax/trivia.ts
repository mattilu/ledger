import { SourceSpan } from './source-span.js';

export interface BlankLinesTrivia {
  readonly kind: 'blank-lines';
  readonly count: number;
  readonly span: SourceSpan;
}

export interface CommentTrivia {
  readonly kind: 'comment';
  /** Raw comment text starting with ';', excluding any trailing newline. */
  readonly text: string;
  readonly span: SourceSpan;
}

export type TriviaItem = BlankLinesTrivia | CommentTrivia;
