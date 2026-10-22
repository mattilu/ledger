# Reports

Reports present balances or activity from a loaded and booked ledger. Run
reports with:

```bash
npm run -s main -- report <report-type> <file> [options]
```

All reports accept `--date` (`-D`) to process Ledger directives through the
given date, inclusive. Account and currency filters use case-insensitive regular
expressions; repeat a filter to add alternatives. The reports that accept
`--date-from` include transactions on that date.

| Report           | What it shows                                                           | Reference                                    |
| ---------------- | ----------------------------------------------------------------------- | -------------------------------------------- |
| `inventory`      | Current positions by account, including cost where available.           | [Inventory report](./inventory.md)           |
| `cash-flow`      | Cumulative postings to selected asset/liability accounts over a period. | [Cash-flow report](./cash-flow.md)           |
| `transactions`   | Booked transactions and their postings.                                 | [Transactions report](./transactions.md)     |
| `unrealized-pnl` | Unrealized gains and losses on held positions with cost basis.          | [Unrealized P&L report](./unrealized-pnl.md) |
