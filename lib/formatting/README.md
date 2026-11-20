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
  `indent`, `line`, `softline`, `hardline`, `ifBreak`, `lineSuffix`,
  `breakParent`).
- `internal/align.ts` resolves two-dimensional amount and inline-comment
  alignment across scopes (`none`, `directive`, `file`, `file-grow-only`,
  `fixed`) and modes (`currency`, `decimal`, `decimal-and-currency`).
- `internal/comment.ts` normalizes `;` comment spacing and trims trailing
  horizontal whitespace.
- `internal/number.ts` performs lexical thousands-separator formatting and
  decimal-part splitting.
- `internal/pragma.ts` detects `; ledger-fmt: off` and `; ledger-fmt: on`
  comment pragmas.
- `internal/verify.ts` checks before returning that formatted output re-parses
  to an equivalent `LedgerSpec` and preserves all comments in order.
