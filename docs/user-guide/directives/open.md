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

Example:

```text
2026-01-01 open Assets:Brokerage:Stocks USD
  trading-account: Trading:Brokerage
  booking-method: "fifo"
```

An account-level booking method applies when reducing costed positions in this
account. Metadata precedence is described in the
[transaction reference](./transaction.md#behavior-changing-metadata).

See the [`open` syntax](../syntax.md#open) and
[account-reference-checks](../options.md#account-reference-checks).
