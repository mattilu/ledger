# Transactions report

The `transactions` report displays booked transactions and their postings.
Filters select transactions by date, flags, and matching postings. The
`--all-postings` option changes the display after a transaction matches: it
shows every posting in that transaction, including postings that did not match
the account or currency filters.

```bash
npm run -s main -- report transactions main.ledger \
  --date-from 2026-01-01 --flag '!' --balance aggregate
```

`--date-from` includes transactions on the given date. Shared `--date` limits
the Ledger directives processed through that date, inclusive.

## Options

| Option                    | Short | Behavior                                                                                                                 |
| ------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------ |
| `--date DATE`             | `-D`  | Process Ledger directives through `DATE`, inclusive.                                                                     |
| `--date-from DATE`        | `-d`  | Include transactions on or after this date.                                                                              |
| `--account REGEX`         | `-a`  | Select matching postings using a case-insensitive regular expression. Repeat to add alternatives.                        |
| `--exclude-account REGEX` | `-A`  | Exclude matching postings using a case-insensitive regular expression. Repeat to add alternatives.                       |
| `--currency REGEX`        | `-c`  | Select postings whose amount currency matches a case-insensitive regular expression. Repeat to add alternatives.         |
| `--flag FLAG`             | `-f`  | Include transactions or postings with this exact flag. Repeat to add alternatives.                                       |
| `--all-postings`          | —     | Once a transaction has a matching posting, display all of its postings, even those excluded by account/currency filters. |
| `--balance MODE`          | `-b`  | Format running balances as `none`, `full`, or `aggregate`. Defaults to `none`.                                           |

Account and currency expressions are case-insensitive, anchored to the entire
name, and combined as alternatives when repeated. A posting must pass the
account, exclusion, currency, and flag filters to qualify. A matching
transaction flag qualifies the transaction; a matching posting flag qualifies
that posting. The report includes a transaction only when at least one posting
qualifies.

Running balance modes:

- `none`: do not display running balances.
- `full`: display the positions in the account after each posting.
- `aggregate`: display one summed balance per account and currency after each
  posting.

## Example

Review flagged transactions and show all balancing postings:

```bash
npm run -s main -- report transactions main.ledger \
  --flag '!' --all-postings --balance full
```
