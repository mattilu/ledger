# Formatting

The `formatting` module formats Ledger source text while preserving all
accounting semantics, comments, intentional blank-line groupings, and raw value
precision.

Like `lib/syntax/` and `lib/parsing/`, `formatting` is pure and file-local: it
does not access the filesystem or resolve `load` directives. Configuration file
discovery and CLI flags live in `cli/`.

## Main pieces

- `formatter.ts` exposes `format(contents, options?)`, returning
  `Either<FormatError, string>`.
- `options.ts` defines `FormatOptions`, `DEFAULT_FORMAT_OPTIONS`, and
  `resolveFormatOptions(raw)` for validating `.ledgerfmt.json` payloads.
- `internal/doc.ts` implements the Wadler–Lindig pretty-printing IR (`group`,
  `fill`, `indent`, `line`, `softline`, `hardline`, `ifBreak`, `lineSuffix`,
  `breakParent`).
- `internal/align.ts` resolves two-dimensional amount and inline-comment
  alignment across scopes (`none`, `directive`, `file`, `file-grow-only`,
  `fixed`) and modes (`currency`, `decimal`, `decimal-and-currency`).
- `internal/cst.ts` and `internal/trivia.ts` provide CST trivia/token inspection
  and `Doc` token helpers shared across formatting passes.
- `internal/expr.ts`, `internal/rules.ts`, and `internal/directives.ts` convert
  dates, expressions, metadata, rule blocks, postings, balance entries,
  directives, and top-level pragma regions into `Doc` trees and alignment
  segments.
- `internal/comment.ts` normalizes `;` comment spacing and trims trailing
  horizontal whitespace.
- `internal/number.ts` performs lexical thousands-separator formatting and
  decimal-part splitting.
- `internal/pragma.ts` detects `; ledger-fmt: off` and `; ledger-fmt: on`
  comment pragmas.
- `internal/verify.ts` checks before returning that formatted output re-parses
  to an equivalent `LedgerSpec` and preserves all comments in order.

## Benchmarks

`formatter.bench.ts` defines the formatter benchmark suite (mixed ledgers up to
10,000 directives, alignment and wrapping workloads, and linear scaling checks).
