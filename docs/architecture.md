# Architecture

> NOTE: This document describes Ledger's current architecture and should be
> updated when implementation changes make it inaccurate. The implementation is
> authoritative if it differs from this overview. For proposed or historical
> designs, see documents in `docs/design/`; those documents do not describe the
> current system unless explicitly stated.

Ledger is a TypeScript, Node.js command-line application and library for
text-based, double-entry bookkeeping. The implementation is organized as a
sequence of transformations: source text becomes parsed specifications, loaded
directives, a booked ledger, and finally report output.

## Execution flow

```text
main.ts
  └─ cli/ (argument parsing and command orchestration)
       ├─ load(input path)
       │    ├─ read files and recursively resolve `load` directives
       │    ├─ lib/parsing/  → LedgerSpec
       │    └─ lib/loading/  → Ledger
       ├─ book(Ledger)       → BookedLedger
       └─ lib/reporting/     → text output
            └─ lib/utils/    → filtering, price lookup, formatting, etc.

lib/core/ supplies shared value types such as Amount.
```

## Module boundaries

| Module                                         | Responsibility                                                                   | Main boundary                                                       |
| ---------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| [`lib/core/`](../lib/core/README.md)           | Small domain value types shared by the pipeline.                                 | `Amount` keeps exact numeric value and currency together.           |
| [`lib/parsing/`](../lib/parsing/README.md)     | Tokenize and parse Ledger language into typed syntax specifications.             | `parse(contents)` returns `Either<ParseError, LedgerSpec>`.         |
| [`lib/loading/`](../lib/loading/README.md)     | Resolve files and evaluate parsed specs into runtime directives.                 | `load(path)` returns `Either<LoadError, Ledger>`.                   |
| [`lib/booking/`](../lib/booking/README.md)     | Apply directives in order, validate accounting constraints, and track positions. | `book(ledger)` returns `Either<BookingError, BookedLedger>`.        |
| [`lib/reporting/`](../lib/reporting/README.md) | Derive report-specific results from a `BookedLedger`.                            | Reports implement `Report.run(BookedLedger): string`.               |
| [`lib/utils/`](../lib/utils/README.md)         | Reusable algorithms and formatting shared by domain modules.                     | Utilities are consumed by the pipeline; they do not orchestrate it. |
| [`cli/`](../cli/README.md)                     | CLI commands, flags, orchestration, and user-facing error conversion.            | Calls `load`, `book`, and report implementations.                   |

The parser's `LedgerSpec` contains typed syntax data rather than runtime
directives. Loading adds evaluated dates, amounts, metadata, option state, and
source context. The booked representation is separate from the loaded
representation: it contains booked transactions, account state, prices, and
inventories, but does not replace the source `Ledger`.

Parsing is intentionally stateless and file-local. A file's parse result must
not require knowledge of another file or prior context; resolving includes and
applying shared options or defaults belongs to loading. This boundary is why the
parser produces syntax-level date specs instead of JavaScript `Date` objects:
loading interprets them with the active timezone and other context.

## Errors and source locations

The pipeline uses `fp-ts` `Either` results for expected parse, load, and booking
failures. Parse errors carry source positions; loading associates them with file
paths and include-stack context; booking errors identify their source directive.
The CLI converts these domain errors to command errors and displays them.
Preserve this error path when adding behavior: do not silently discard errors or
return a success-shaped fallback.

## Immutability across module boundaries

Public data structures passed between modules must be immutable. This prevents
one module from unexpectedly changing state observed by another. Use
Immutable.js collections for shared maps, lists, and sets, and expose read-only
properties and types where appropriate. Mutable data structures are fine for
internal implementation details, provided they are not exposed across a module
boundary.

## Accounting model and compatibility

Ledger requires the signed posting amounts in each transaction to sum to zero
independently for each currency. Its account sign convention can be expressed as
`Assets + Liabilities + Equity + Income + Expenses + Trading = 0`: income is
negative, while expenses are positive. This convention was chosen for
compatibility with Beancount, which originally inspired the project. It can be
surprising, and sign configuration is not currently implemented.

To keep multi-currency transactions balanced, Ledger uses Trading accounts and
implicitly adds postings for the opposite commodity amount and total cost, when
cost or price specs are provided; these entries make the transaction balance per
currency. Users can also explicitly post to Trading accounts if they choose not
to use the cost or price specs.
