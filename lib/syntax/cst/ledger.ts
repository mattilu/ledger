import { TriviaItem } from '../trivia.js';
import { DirectiveCst, ResilientDirectiveCst } from './directive.js';

export interface SyntaxTree {
  readonly source: string;
  readonly directives: readonly DirectiveCst[];
  readonly eofTrivia: readonly TriviaItem[];
}

export interface ResilientSyntaxTree {
  readonly source: string;
  readonly directives: readonly ResilientDirectiveCst[];
  readonly eofTrivia: readonly TriviaItem[];
}
