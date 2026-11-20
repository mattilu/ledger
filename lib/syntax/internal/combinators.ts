import {
  apply,
  betterError,
  ParseError,
  Parser,
  ParseResult,
  resultOrError,
  seq,
  Token,
} from 'typescript-parsec';

interface ConsNode<T> {
  readonly value: T;
  readonly prev: ConsNode<T> | undefined;
}

interface Step<TKind, TResult> {
  readonly firstToken: Token<TKind> | undefined;
  readonly nextToken: Token<TKind> | undefined;
  readonly node: ConsNode<TResult> | undefined;
  readonly length: number;
}

function toArray<T>(node: ConsNode<T> | undefined, length: number): T[] {
  const out = new Array<T>(length);
  let cur = node;
  let i = length;
  while (cur !== undefined) {
    out[--i] = cur.value;
    cur = cur.prev;
  }
  return out;
}

/**
 * Repeats `p` zero or more times in linear time (`O(n)`).
 *
 * Drop-in replacement for `typescript-parsec`'s `rep_sc` that accumulates
 * matches in a persistent reverse cons-list instead of copying an array on each
 * step.
 *
 * @param p Element parser to repeat.
 * @returns A parser producing an array of matched elements.
 */
export function rep_sc<TKind, TResult>(
  p: Parser<TKind, TResult>,
): Parser<TKind, TResult[]> {
  return {
    parse(token) {
      let error: ParseError | undefined;
      let result: Step<TKind, TResult>[] = [
        { firstToken: token, nextToken: token, node: undefined, length: 0 },
      ];
      while (true) {
        const steps = result;
        result = [];
        for (const step of steps) {
          const output = p.parse(step.nextToken);
          error = betterError(error, output.error);
          if (output.successful) {
            for (const candidate of output.candidates) {
              if (candidate.nextToken !== step.nextToken) {
                result.push({
                  firstToken: step.firstToken,
                  nextToken: candidate.nextToken,
                  node: { value: candidate.result, prev: step.node },
                  length: step.length + 1,
                });
              }
            }
          }
        }
        if (result.length === 0) {
          const finalCandidates: ParseResult<TKind, TResult[]>[] = steps.map(
            step => ({
              firstToken: step.firstToken,
              nextToken: step.nextToken,
              result: toArray(step.node, step.length),
            }),
          );
          return resultOrError(finalCandidates, error, true);
        }
      }
    },
  };
}

/**
 * Parses left-recursive chains `p q*` in linear time (`O(n)`).
 *
 * Drop-in replacement for `typescript-parsec`'s `lrec_sc` built on the linear
 * `rep_sc` combinator above instead of upstream's quadratic `rep_sc`.
 *
 * @param p Initial operand parser.
 * @param q Repeated operator/operand continuation parser.
 * @param callback Left-fold combiner applied for each matched `q`.
 * @returns A parser producing the folded `TResult`.
 */
export function lrec_sc<TKind, TResult, TFirst extends TResult, TSecond>(
  p: Parser<TKind, TFirst>,
  q: Parser<TKind, TSecond>,
  callback: (a: TResult, b: TSecond) => TResult,
): Parser<TKind, TResult> {
  return apply(seq(p, rep_sc(q)), ([first, tails]) => {
    let result: TResult = first;
    for (const tail of tails) {
      result = callback(result, tail);
    }
    return result;
  });
}
