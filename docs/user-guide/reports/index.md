# Reports

Reports present balances or activity from a loaded and booked ledger. Run
reports with:

```bash
npm run -s main -- report <report-type> <file> [options]
```

All reports accept `--date` (`-D`) to process Ledger directives through the
given date, inclusive. Account and currency filters use case-insensitive regular
expressions; repeat a filter to add alternatives. The reports that accept
`--date-from` include transactions on that date. Every report accepts
`--sign-convention` to override its sign presentation; see the supported values
in [Ledger-file options](../options.md#sign-convention). Account-bound reports
otherwise use the root file's final `sign-convention` setting; the transactions
report uses the convention active at each transaction.

| Report           | What it shows                                                           | Reference                                    |
| ---------------- | ----------------------------------------------------------------------- | -------------------------------------------- |
| `inventory`      | Current positions by account, including cost where available.           | [Inventory report](./inventory.md)           |
| `cash-flow`      | Cumulative postings to selected asset/liability accounts over a period. | [Cash-flow report](./cash-flow.md)           |
| `transactions`   | Booked transactions and their postings.                                 | [Transactions report](./transactions.md)     |
| `unrealized-pnl` | Unrealized gains and losses on held positions with cost basis.          | [Unrealized P&L report](./unrealized-pnl.md) |
