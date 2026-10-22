# `price`

`price` adds a dated exchange rate to the price database. The price amount's
currency is the quote currency, and the directive's currency is the base
currency.

For example, the following records that one EUR is worth 1.08 USD:

```text
2026-01-01 price EUR 1.08 USD
```

The price database is used by the
[unrealized P&L report](../reports/unrealized-pnl.md). That report may use
indirect currency conversions. When a position has no usable price for its cost
currency, the report treats its cost as its current price.

Cost annotations and price annotations on transaction postings can also
synthesize price entries during booking; see [Transaction](./transaction.md) and
[Booking](../booking.md).

See the [`price` syntax](../syntax.md#price).
