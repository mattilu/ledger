# Reporting

The `reporting` module derives report data from a `BookedLedger` and returns
human-readable strings. It does not parse source files or book directives; the
CLI invokes those earlier pipeline stages.

## Main pieces

- `report.ts` defines the `Report` contract:
  `run(ledger: BookedLedger): string`.
- `transactions.ts`, `inventory.ts`, `cash-flow.ts`, and `unrealized-pnl.ts`
  implement the available reports and their filters/calculations.
- `internal/regexp-utils.ts` contains shared report filtering logic.
- `internal/testing.ts` provides test fixture collection helpers.

Shared rendering and account-tree formatting live in `lib/utils/formatting.ts`.

## Tests and changes

Report tests are colocated with implementations. They use fixture scenarios and
expected output in each report's `testdata/` directory. Add coverage for
filters, options, and edge cases along with the report behavior. To expose a new
report through the CLI, also update `cli/report.ts` and the user-facing command
documentation.
