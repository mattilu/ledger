# Contributing

This guide describes how to set up a development environment, run quality
checks, and extend Ledger.

## Development setup

Ledger requires Node.js 22 or later. Install the project dependencies with:

```bash
npm install
```

## Code quality

### Tests

The project uses Node's test runner to run TypeScript through `tsx`. Run
`npm test` to execute the test suite, or `npm run test-watch` to rerun tests
when files change.

Tests live beside their implementation and commonly use `node:test` plus
`node:assert/strict`.

Parser and booking tests use paired `.ledger` / `.json` files in each module's
`testdata/` directory. Reporting tests use scenarios and golden output fixtures.
Keep fixtures focused, update expected outputs when behavior changes
intentionally, and include negative cases for invalid input.

> NOTE: Changes to files in `testdata/` do not currently trigger test runs in
> watch mode.

Because `tsx` does not perform type checking, run `npm run typecheck`
separately.

### Linting and formatting

Ledger uses ESLint to lint TypeScript code, markdownlint-cli2 to check Markdown
documents, and Prettier to format files.

Run the linters:

```bash
npm run lint:code
npm run lint:docs
```

Check formatting:

```bash
npm run prettier-check
```

Format files:

```bash
npm run prettier-format
```

### Pre-commit hooks

Ledger uses Husky to run a pre-commit hook. To run the same checks manually
before committing, use `npm run pre-commit`.

## Extending the project

### Add or change a directive

1. Define or update the typed syntax shape under `lib/parsing/spec/`.
2. Add tokenizer/parser support under `lib/parsing/internal/` and cover both
   valid and invalid input in `lib/parsing/testdata/` and parser tests.
3. Convert the parsed spec into a runtime directive in `lib/loading/`, keeping
   option, metadata, date evaluation, and source context behavior consistent.
4. Handle the directive in `lib/booking/booking.ts` if it affects booked state,
   validations, or generated data.
5. Add tests at each affected layer. The parser and booking suites use paired
   `.ledger` input and `.json` expected-output fixtures.
6. Update the corresponding end-user directive page under
   `docs/user-guide/directives/` when the syntax or behavior is user-visible.

Not every directive necessarily needs behavior in each layer; follow the closest
existing directive rather than introducing a parallel path.

### Add a report

Implement `Report` in `lib/reporting/`, accept a `BookedLedger`, and keep
report-specific filtering and calculation in that layer. Use
`lib/utils/formatting.ts` for shared output conventions. Add report tests and
fixtures following the existing report test helpers, then wire CLI arguments and
invocation in `cli/report.ts` and document the user-facing command.

### Change booking behavior

Keep inventory transitions and accounting validation in `lib/booking/`. Where a
new lot-reduction strategy is needed, the existing `BookingMethod` interface is
the extension boundary; FIFO and LIFO are implementations. Add fixture coverage
for successful and failing cases and verify that the emitted postings and
resulting inventories match expectations.
