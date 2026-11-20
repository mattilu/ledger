# Syntax

The `syntax` module tokenizes Ledger source text losslessly and parses it into a
concrete syntax tree (`SyntaxTree`) that preserves comments, blank-line counts,
raw numeric strings, parentheses, punctuation tokens, and full UTF-16
`SourceSpan`s.

Like `lib/parsing/`, `syntax` is completely stateless and file-local: it does
not perform filesystem I/O, resolve `load` directives, or evaluate accounting
semantics.

## Main pieces

- `parser.ts` exposes `parseSyntax(contents)` (strict, returning
  `Either<SyntaxError, SyntaxTree>`) and `parseSyntaxResilient(contents)`
  (error-recovering, returning `ResilientSyntaxTree` with `ErrorCst` nodes).
- `cst/` defines the immutable CST types organized by construct (`amount.ts`,
  `common.ts`, `condition.ts`, `date.ts`, `directive.ts`, `error.ts`,
  `expression.ts`, `ledger.ts`, `metadata.ts`, and `cst/directives/*.ts`),
  mirroring `lib/parsing/spec/`.
- `token.ts`, `trivia.ts`, `source-span.ts`, and `error.ts` define token,
  comment/blank-line trivia, span, and error types.
- `internal/tokenizer.ts` performs longest-match tokenization and attaches
  leading/trailing comment and blank-line trivia to tokens.
- `internal/ledger.ts` and `internal/directives/*.ts` compose the per-directive
  `typescript-parsec` CST parsers alongside
  `internal/{account-choice,amount,condition,date,expression,metadata,primitives,recover,source-span}.ts`.
