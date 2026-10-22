# Ledger

Ledger is a text-based double-entry bookkeeping system for recording financial
transactions in a human-readable format and generating reports. Ledger was
inspired by [Beancount](https://github.com/beancount/beancount).

## Quick Start

1. Clone the repository:

   ```bash
   git clone https://github.com/mattilu/ledger.git
   cd ledger
   ```

2. Install the dependencies:

   ```bash
   npm install
   ```

3. Write your first Ledger file:

   ```bash
   cat << EOF > my.ledger
   2026-10-01 * "Hello, world!"
     Assets:Bank   1000 USD
     Equity:Opening-Balances
   EOF
   ```

4. Generate a report:

   ```bash
   npm run -s main -- report cash-flow my.ledger
   ```

## Documentation

For more information, see the documentation:

- [Installation](docs/user-guide/installation.md) — set up and run the CLI.
- [Getting started](docs/user-guide/getting-started.md) and the
  [cookbook](docs/user-guide/cook-book.md) — create your first Ledger file and
  explore common patterns.
- [Syntax](docs/user-guide/syntax.md) — learn the Ledger file format.
- [Directives](docs/user-guide/directives/index.md) and
  [options](docs/user-guide/options.md) — configure accounts, transactions,
  currencies, and Ledger behavior.
- [Booking](docs/user-guide/booking.md) — understand accounting rules.
- [Commands](docs/user-guide/commands.md) and
  [reports](docs/user-guide/reports/index.md) — explore CLI usage and report
  types.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
