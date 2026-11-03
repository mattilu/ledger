# Ledger-file options

Options are set with the undated `option` directive and affect subsequent
directives in the current loading frame. See [Option](./directives/option.md)
for scope rules. This page lists the Ledger file options implemented by the
loader and booking engine. Command-line flags are documented in
[Commands](./commands.md) and on the relevant
[report pages](./reports/index.md).

| Option                     | Default   | Supported values                                                       | Effect                                                                                                                 |
| -------------------------- | --------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `account-reference-checks` | `lenient` | `none`, `lenient`, `strict`                                            | Controls whether accounts must have an `open` directive and whether postings to closed accounts are rejected.          |
| `booking-method`           | `fifo`    | `fifo`, `lifo`                                                         | Selects which costed position is reduced first when a posting reduces an inventory. Metadata can override this option. |
| `default-timezone`         | `Z` (UTC) | `Z` or a `[+-]hh:mm` offset                                            | Supplies the timezone for dates that have a time but no explicit timezone. Dates without times remain date-only/UTC.   |
| `sign-convention`          | `legacy`  | `legacy`, `beancount`, `normal-balance-positive`, `net-worth-positive` | Selects the sign convention used for transaction and balance amounts.                                                  |

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

## `sign-convention`

The default, `legacy`, preserves existing ledger files behavior. `beancount` is
an alias for the same signs. The other conventions change how signed transaction
and balance amounts are entered:

- `normal-balance-positive`: positive amounts represent an increase on the
  account's normal-balance side.
- `net-worth-positive`: positive amounts represent increases in net worth,
  negative amounts decreases.

```text
option "sign-convention" "normal-balance-positive"
```

Each transaction and balance assertion uses the value active where it appears.
Loading converts these amounts to Ledger's canonical signed representation
before booking, so transactions still balance to zero per currency. Cost and
price values are not converted.

For each standard account type, the following table gives user-facing signs for
**debit** / **credit** / **normal-balance increase**, using the account type's
standard normal-balance side. `+` and `-` are the signs users enter and see.

| Account type | Normal balance | `legacy` / `beancount` | `normal-balance-positive` | `net-worth-positive` |
| ------------ | -------------- | ---------------------- | ------------------------- | -------------------- |
| Assets       | Debit          | + / - / +              | + / - / +                 | + / - / +            |
| Liabilities  | Credit         | + / - / -              | - / + / +                 | + / - / -            |
| Equity       | Credit         | + / - / -              | - / + / +                 | - / + / +            |
| Income       | Credit         | + / - / -              | - / + / +                 | - / + / +            |
| Expenses     | Debit          | + / - / +              | + / - / +                 | - / + / -            |
| Trading      | Credit         | + / - / -              | - / + / +                 | - / + / +            |

`Trading` accounts balance multi-currency entries and don't have a standard
debit/credit normal side, the mapping has been chosen to show long positions as
credits and short positions as debits.

An account can override its family’s normal side with string metadata on `open`:

```text
2026-01-01 open Expenses:Credit-Card:Rebates
  normal-balance: "credit"
```

When an account's normal-balance side is opposite its type's standard side (a
contra-account), the mappings are:

| Account type | Normal balance | `legacy` / `beancount` | `normal-balance-positive` | `net-worth-positive` |
| ------------ | -------------- | ---------------------- | ------------------------- | -------------------- |
| Assets       | Credit         | + / - / -              | - / + / +                 | + / - / -            |
| Liabilities  | Debit          | + / - / +              | + / - / +                 | + / - / +            |
| Equity       | Debit          | + / - / +              | + / - / +                 | - / + / -            |
| Income       | Debit          | + / - / +              | + / - / +                 | - / + / -            |
| Expenses     | Credit         | + / - / -              | - / + / +                 | - / + / +            |
| Trading      | Debit          | + / - / +              | + / - / +                 | - / + / -            |

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
