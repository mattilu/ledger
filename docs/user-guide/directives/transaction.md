# `transaction`

A transaction is booked atomically: its postings must balance, with omitted
amounts inferred from the transaction's running balance. The running balance is
tracked separately for each currency.

See [Booking](../booking.md) for the sign convention and booking process.

Transaction and posting flags (`*`, `!`) are labels, not built-in accounting
states. A posting without its own flag inherits the transaction flag. The
[transactions report](../reports/transactions.md) can filter on either.

## Behavior-changing metadata

The booking engine reads the following metadata from the transaction, postings,
and the account's active `open` directive:

| Metadata          | Type    | Effect                                                                                                                                                                                      |
| ----------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `trading-account` | Account | Chooses where booking-generated counter-postings are recorded. Precedence: posting, transaction, open account, then `Trading:Default`.                                                      |
| `booking-method`  | String  | Chooses how costed positions are selected when reduced. Precedence: posting, transaction, open account, then the `booking-method` option. Supported values are lowercase `fifo` and `lifo`. |

For example, an account can provide a default trading account, while one
transaction can override it:

```text
2026-01-01 open Assets:Brokerage:Stocks
  trading-account: Trading:Brokerage

2026-01-02 * "Buy shares"
  trading-account: Trading:Special
  Assets:Brokerage:Stocks 2 ACME {{ 100 USD }}
  Assets:Brokerage:Cash
```

Cost and price annotations on postings also affect booking. A cost basis adds a
position held at cost and generated trading postings; a price annotation
converts currencies without retaining the position at cost. On reductions, an
empty cost selector (for example `{}`) invokes the booking method to choose
existing positions. For the full rules and worked entries, see
[Booking](../booking.md).

See the [`transaction` syntax](../syntax.md#transaction).
