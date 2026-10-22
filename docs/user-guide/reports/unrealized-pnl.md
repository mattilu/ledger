# Unrealized P&L report

The `unrealized-pnl` report estimates gains or losses on held positions that
have a cost basis. It compares the booked per-unit cost with prices in the
Ledger's price database. If no price is available for a position and cost
currency pair, the report uses the cost as the current price, producing zero
unrealized P&L for that pair.

```bash
npm run -s main -- report unrealized-pnl main.ledger
```

The report can use indirect currency conversions when finding prices. It reports
per-position values by default.

## Options

| Option                    | Short | Behavior                                                                                                                           |
| ------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `--date DATE`             | `-D`  | Process Ledger directives through `DATE`, inclusive.                                                                               |
| `--account REGEX`         | `-a`  | Include accounts matching this case-insensitive regular expression. Repeat to add alternatives.                                    |
| `--exclude-account REGEX` | `-A`  | Exclude accounts matching this case-insensitive regular expression. Repeat to add alternatives.                                    |
| `--currency REGEX`        | `-c`  | Include positions whose commodity or cost currency matches this case-insensitive regular expression. Repeat to add alternatives.   |
| `--aggregate`             | `-G`  | Aggregate P&L by position and cost currency instead of showing each position separately.                                           |
| `--hide-cost`             | `-C`  | Exposed by the shared CLI options, but currently does not suppress the cost values printed by this report.                         |
| `--tree`                  | `-t`  | Display accounts as a hierarchy.                                                                                                   |
| `--totals`                | `-T`  | Show descendant totals on parent accounts; only applies with `--tree`.                                                             |
| `--max-depth N`           | `-M`  | Limit displayed tree depth; only applies with `--tree`. Elided descendants are included in the nearest displayed ancestor's total. |

The report only includes positions with a cost basis. Regular expressions are
case-insensitive, anchored to the full account or currency name, and repeated
patterns are alternatives. `--aggregate` merges positions with the same position
currency and cost/P&L currency.

## Example

Show aggregated P&L for brokerage positions:

```bash
npm run -s main -- report unrealized-pnl main.ledger \
  --account 'Assets:Brokerage:.*' --aggregate
```
