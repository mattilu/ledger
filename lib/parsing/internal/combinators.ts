import {
  betterError,
  ParseError,
  Parser,
  ParseResult,
  resultOrError,
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
