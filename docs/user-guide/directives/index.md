# Directives

Directives configure loading and describe dated Ledger events. The
[syntax guide](../syntax.md) is the shared reference for grammar, amounts,
metadata value syntax, and transaction posting syntax. The pages below focus on
what each directive does, behavior-changing metadata, and practical constraints.

## Undated directives

| Directive | Purpose                                                   | Reference             |
| --------- | --------------------------------------------------------- | --------------------- |
| `option`  | Set loader or booking behavior for subsequent directives. | [Option](./option.md) |
| `load`    | Include another Ledger file, optionally using a glob.     | [Load](./load.md)     |

## Dated directives

| Directive         | Purpose                                                    | Reference                       |
| ----------------- | ---------------------------------------------------------- | ------------------------------- |
| `open`            | Declare an account and optionally restrict its currencies. | [Open](./open.md)               |
| `close`           | Stop ordinary postings to an account.                      | [Close](./close.md)             |
| `currency`        | Define a currency and display metadata.                    | [Currency](./currency.md)       |
| `commodity`       | Alias for `currency`.                                      | [Commodity](./commodity.md)     |
| `txn` / `*` / `!` | Record a balanced transaction and its postings.            | [Transaction](./transaction.md) |
| `balance`         | Assert account balances on a date.                         | [Balance](./balance.md)         |
| `price`           | Add a market price for reporting and valuation.            | [Price](./price.md)             |
