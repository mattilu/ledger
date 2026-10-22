# CLI commands

Run the CLI from the repository with:

```bash
npm run -s main -- <command> [arguments] [options]
```

When installed as a package, use `npx ledger` in place of `npm run -s main --`.
Use `--help` on the CLI or a command to see its usage.

## Commands

### `validate <file>`

Loads and books a ledger without producing a report. A successful validation
exits without output; a parse, load, or booking error is reported with its
source location.

```bash
npm run -s main -- validate main.ledger
```

### `debug <file> --line N`

Prints the nearest preceding loaded directive and its booked transaction state
for a source line. By default, the source file is the input Ledger file.

| Option        | Short | Description                                                 |
| ------------- | ----- | ----------------------------------------------------------- |
| `--file FILE` | `-f`  | Source file containing the directive. Defaults to `<file>`. |
| `--line N`    | `-l`  | Source line number to inspect.                              |

```bash
npm run -s main -- debug main.ledger --line 42
npm run -s main -- debug main.ledger --file entries/2026.ledger --line 12
```

### `report <report-type> <file>`

Generates one of the supported reports: `inventory`, `cash-flow`,
`transactions`, or `unrealized-pnl`. Each report accepts `--date` (`-D`) to
process directives through a date, inclusive. For report-specific date, filter,
and formatting options, see the [reports reference](./reports/index.md) and the
page for the report you plan to run.

```bash
npm run -s main -- report inventory main.ledger
npm run -s main -- report transactions main.ledger --flag '!'
```

The available reports are:

- [Inventory](./reports/inventory.md)
- [Cash-flow](./reports/cash-flow.md)
- [Transactions](./reports/transactions.md)
- [Unrealized P&L](./reports/unrealized-pnl.md)
