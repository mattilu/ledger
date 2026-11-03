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

Reports convert canonical balances and postings at presentation time using their
selected sign convention and account normal balance sides. Unless overridden,
account-related reports use the root file's final convention, while transaction
related reports use the convention captured at each transaction.

## Tests and changes

Report tests are colocated with implementations. They use fixture scenarios and
expected output in each report's `testdata/` directory. Add coverage for
filters, options, and edge cases along with the report behavior. To expose a new
report through the CLI, also update `cli/report.ts` and the user-facing command
documentation.
