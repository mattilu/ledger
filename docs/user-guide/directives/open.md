# `open`

`open` records that an account is available from a date. Account checks are
controlled by `account-reference-checks`; see [Options](../options.md).

Opening an already open account is an error. An account that was closed may be
opened again.

If currencies are listed, postings to the account are limited to those
currencies. With no list, the directive imposes no currency restriction.

An `open` directive can also provide default account-level metadata for booking.
The supported keys are:

| Metadata          | Type    | Effect                                                                                                       |
| ----------------- | ------- | ------------------------------------------------------------------------------------------------------------ |
| `trading-account` | Account | Selects the trading account used for generated postings when the transaction and posting do not override it. |
| `booking-method`  | String  | Selects `fifo` or `lifo` when not overridden by transaction/posting metadata.                                |
| `normal-balance`  | String  | Sets this account's normal side to `debit` or `credit` for sign presentation.                                |

Example:

```text
2026-01-01 open Assets:Brokerage:Stocks USD
  trading-account: Trading:Brokerage
  booking-method: "fifo"

2026-01-01 open Expenses:Credit-Card:Rebates
  normal-balance: "credit"
```

An account-level booking method applies when reducing costed positions in this
account. Metadata precedence is described in the
[transaction reference](./transaction.md#behavior-changing-metadata).

`normal-balance` is inherited by descendant accounts unless they have a nearer
override. The setting persists after the account is closed. Reopening with a new
`normal-balance` replaces its override; reopening without the metadata clears
that account's override. Invalid values or non-string metadata are load errors.
See [Sign conventions](../options.md#sign-convention).

See the [`open` syntax](../syntax.md#open) and
[account-reference-checks](../options.md#account-reference-checks).
