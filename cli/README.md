# CLI

The `cli` module defines the `ledger` commands and connects user arguments to
the library pipeline. It should only contain orchestration and presentation
code.

## Main files

- `app.ts` registers the various subcommands (e.g. `debug`, `report`,
  `validate`). Each subcommand is declare in its own file.
- `error.ts` converts `LoadError` and `BookingError` into command-facing
  messages while preserving the cause.
- `types/` adapts specific types (e.g. `date`) to the `cmd-ts` argument parser.

## Tests and changes

CLI-specific tests are colocated with their command support files where needed
(for example `types/date.test.ts`).

There are no end-to-end CLI tests at the moment. Changes to reporting or
formatting should be covered in the corresponding `lib/reporting/` or
`lib/utils/` tests.

When adding a command or report, wire it in `app.ts` or `report.ts` and update
`docs/user-guide/commands.md` and/or `docs/user-guide/reports/` accordingly.
