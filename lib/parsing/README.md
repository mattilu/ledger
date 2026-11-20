# Parsing

The `parsing` module converts Ledger source language into a semantic
specification AST (`LedgerSpec`) by lowering the lossless concrete syntax tree
produced by `lib/syntax/`. It does not deal with I/O, accounting, or reporting.

Parsing is stateless and file-local: parsing one file must not depend on another
file's contents or parse results. Keep cross-file and Ledger-wide context in the
loader. For example, the parser represents dates as `DateSpec` syntax rather
than resolving them to JavaScript `Date` values; the loader applies the relevant
timezone and other loading context when it evaluates those specs.

## Main pieces

- `parser.ts` exposes `parse(contents)`, returning
  `Either<ParseError, LedgerSpec>`, and `lowerSyntaxTree(tree)`.
- `internal/lower.ts` lowers `SyntaxTree` nodes from `lib/syntax/` into
  `LedgerSpec` values.
- `spec/` defines the semantic AST, including directive, amount, date,
  expression, and metadata specifications.
- `source-position.ts` and `error.ts` carry parse location and error details.
- `testdata/` holds Ledger inputs and expected parser results.

Loading consumes `LedgerSpec` and converts specs into runtime values. Keep
tokenization and grammar rules in `lib/syntax/` and semantic AST lowering here;
place file inclusion, filesystem reads, timezone/option evaluation, and runtime
directives in `lib/loading/`.

## Tests and changes

`parser.test.ts` discovers `.ledger` / `.json` fixture pairs in `testdata/`. Add
successful and malformed-input cases when changing grammar, and preserve useful
source positions in errors.

`parser.bench.ts` defines the parser benchmark suite (realistic mixed ledgers up
to 50,000 directives, isolated syntax constructs, and complexity scaling pairs).
Extend its generators when introducing new grammar constructs.
