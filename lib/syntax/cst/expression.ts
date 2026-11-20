import { SourceSpan } from '../source-span.js';
import { RichToken } from '../token.js';

export type ExpressionCst =
  | {
      readonly type: 'literal';
      readonly token: RichToken;
      readonly span: SourceSpan;
    }
  | {
      readonly type: 'unary';
      readonly op: '+' | '-';
      readonly opToken: RichToken;
      readonly expr: ExpressionCst;
      readonly span: SourceSpan;
    }
  | {
      readonly type: 'binary';
      readonly op: '+' | '-' | '*' | '/';
      readonly opToken: RichToken;
      readonly lhs: ExpressionCst;
      readonly rhs: ExpressionCst;
      readonly span: SourceSpan;
    }
  | {
      readonly type: 'paren';
      readonly openParen: RichToken;
      readonly expr: ExpressionCst;
      readonly closeParen: RichToken;
      readonly span: SourceSpan;
    };
