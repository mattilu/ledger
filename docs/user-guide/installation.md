# Installation

Follow these steps to set up the `ledger` CLI on your machine.

## Prerequisites

- **Node.js**: Version 22.0 or higher is required.
- **npm**: Installed along with Node.js.

## Setup

1. Clone the repository:

   ```bash
   git clone https://github.com/mattilu/ledger.git
   cd ledger
   ```

2. Install the dependencies:

   ```bash
   npm install
   ```

## Running the CLI

The CLI is accessed via `npm run main`.

```bash
npm run main -- <subcommand> [options]
```

For a full list of all available subcommands, run:

```bash
npm run main -- --help
```

## Alternative Setup

For a more integrated workflow, you can create your own `npm` project and add
`ledger` as a dependency.

1. Initialize your project:

   ```bash
   mkdir personal-finance && cd personal-finance
   npm init -y
   ```

2. Install `ledger` and `tsx`:

   ```bash
   npm install --save tsx https://github.com/mattilu/ledger.git
   ```

3. Execute `ledger` commands via `npx`:

   ```bash
   npx ledger <subcommand> [options]
   ```

This setup also makes it easy to keep your records under version control.

### Customizing Your Workflow

To speed up your daily tasks, you can add custom scripts to your `package.json`.
This allows you to run frequent reports with simple commands.

**`package.json`**

```json
{
  "scripts": {
    "test": "npx ledger validate main.ledger",
    "pre-commit": "npm run test",
    "report-cash-flow": "npx ledger report cash-flow main.ledger",
    "report-inventory": "npx ledger report inventory main.ledger",
    "report-transactions": "npx ledger report transactions main.ledger"
  }
}
```

```bash
npm run report-cash-flow -- [options]
```
