# Ledger-file options

Options are set with the undated `option` directive and affect subsequent
directives in the current loading frame. See [Option](./directives/option.md)
for scope rules. This page lists the Ledger file options implemented by the
loader and booking engine. Command-line flags are documented in
[Commands](./commands.md) and on the relevant
[report pages](./reports/index.md).

| Option                     | Default   | Supported values            | Effect                                                                                                                 |
| -------------------------- | --------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `account-reference-checks` | `lenient` | `none`, `lenient`, `strict` | Controls whether accounts must have an `open` directive and whether postings to closed accounts are rejected.          |
| `booking-method`           | `fifo`    | `fifo`, `lifo`              | Selects which costed position is reduced first when a posting reduces an inventory. Metadata can override this option. |
| `default-timezone`         | `Z` (UTC) | `Z` or a `[+-]hh:mm` offset | Supplies the timezone for dates that have a time but no explicit timezone. Dates without times remain date-only/UTC.   |

## `account-reference-checks`

- `none`: bypasses account-state checks, including undeclared-account and
  closed-account checks.
- `lenient` (default): allows postings to accounts that were never opened, but
  rejects postings to accounts that have been closed.
- `strict`: requires an account to have been opened before use and rejects
  postings after closure.

`open`, `close`, transactions, and balance assertions are subject to these
checks. Balance assertions are allowed on closed accounts. A currency list on an
`open` directive restricts postings to those currencies independently of this
setting.

```text
option "account-reference-checks" "strict"
```

## `booking-method`

The default is `fifo`: reduce the oldest matching costed position first. `lifo`
reduces the newest matching position first. This option is used when a position
is reduced without a more-specific `booking-method` metadata value. The value is
lowercase and must be one of the supported methods. An unsupported value
produces a booking error when a reduction consults it.

```text
option "booking-method" "lifo"
```

Transaction, posting, and open-account metadata can override the option. See
[Transaction metadata](./directives/transaction.md#behavior-changing-metadata).

## `default-timezone`

Dates with an explicit timezone are unaffected. Dates without a time are
interpreted as UTC. For dates with a time but no timezone, the default is UTC;
setting this option changes that interpretation:

```text
option "default-timezone" "+01:00"
```

Options are local to a file-loading frame: included files inherit the current
values but changes inside them do not alter their parent's later directives. See
[Load](./directives/load.md) and the [`option` syntax](./syntax.md#option).
