# Loading

The `loading` module converts parsed AST into runtime Ledger directives. It
handles file-level concerns and evaluation, bridging the parser's syntax tree
and booking's domain operations.

## Main pieces

- `loader.ts` exposes `load(filePath)`, which reads and parses files, resolves
  `load` directives (including glob patterns), evaluates values and options,
  collects directives, and sorts them by date.
- `directive.ts`, `ledger.ts`, and `directives/` define runtime directive shapes
  and the `Ledger` returned to booking.
- `metadata.ts` defines evaluated metadata values.
- `source-context.ts` tracks source file and location; `error.ts` defines
  `LoadError` with source and include-stack context.

The loader depends on `lib/parsing/` for syntax and `lib/core/` for values. Keep
accounting validation and inventory transitions in `lib/booking/`.

## Tests and changes

`loader.test.ts` uses paired `.ledger` and `.json` fixtures under `testdata/`.
Cover file inclusion, option state, metadata/date/amount evaluation, source
locations, and failure cases when changing load behavior. Errors are returned as
`Either<LoadError, Ledger>`; do not swallow errors while resolving a file or
directive.
