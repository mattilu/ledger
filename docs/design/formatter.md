# Ledger source formatter

- **Status:** Proposed.
- **Supersedes:** None.

Ledger's whitespace-insensitive grammar lets users enter directives flexibly,
but hand-maintaining consistent indentation, posting alignment, rule-block
wrapping, and number separators across large journals is tedious and
error-prone. Existing parsing infrastructure produces a semantic `LedgerSpec`
that strips comments, blank lines, parentheses, and raw lexical forms needed by
a source formatter.

This proposal introduces a lossless concrete syntax tree (CST), a configurable
source formatter library (`lib/formatting/`), and a `ledger fmt` CLI command
suitable for command-line workflows and code editors such as VS Code and Vim,
while sharing one grammar with the existing `LedgerSpec` parser and retaining
full source spans for future IDE tooling.

## Background

Ledger files are plain-text financial journals read and edited directly by
humans. Although the lexer ignores spaces and newlines between tokens, authors
rely on visual structure to audit entries quickly:

```text
; Unformatted input
2026-04-03 * "Monthly salary and tax withholding"
  Income:Salary -5500.00 CHF ; gross
  Expenses:Taxes:Withholding 825 CHF
  Assets:Bank:Checking 4,675.00 CHF
```

In practice, authors want consistent two-space indentation, vertically aligned
amounts and currencies, normalized spacing around comments and operators, and
predictable wrapping of long `account-rule` and `choose account` blocks:

```text
; Formatted output (currency-aligned or decimal-and-currency-aligned)
2026-04-03 * "Monthly salary and tax withholding"
  Income:Salary               -5,500.00 CHF  ; gross
  Expenses:Taxes:Withholding     825    CHF
  Assets:Bank:Checking         4,675.00 CHF
```

Currently, `lib/parsing/` cannot power a source formatter directly for four
reasons:

1. **Discarded trivia.** `lib/parsing/internal/tokenizer.ts` discards whitespace
   and `;` comments during tokenization, losing standalone comments, inline
   end-of-line comments, and intentional blank-line groupings.
2. **Canonicalized values.** `NumberLiteral` tokens are parsed immediately into
   `ExactNumber` instances, erasing trailing fractional zeroes (`100.00` vs
   `100`) and thousands separators (`1,000` vs `1000`). Arithmetic and condition
   ASTs drop explicit parentheses, `MetadataSpec` stores entries in an unordered
   `Immutable.Map`, `CostSpec` separates items by type rather than source order,
   and `txn` is normalized to `*`.
3. **Coarse source locations.** Only top-level directives record `srcPos` (start
   line and column only); postings, metadata entries, rule clauses, and
   expressions carry no spans.
4. **All-or-nothing parsing.** A single mid-edit syntax error aborts parsing of
   the entire file, which prevents resilient tooling in interactive editors.

At the same time, duplicating the Ledger grammar in a second standalone parser
would risk syntax drift whenever directives or `choose account` rules evolve.

## Objective

Provide a deterministic, configurable, comment-preserving formatter for Ledger
files—exposed both as a pure TypeScript API and as a `ledger fmt` CLI subcommand
integratable into editors and CI—backed by a single shared syntax grammar that
lowers cleanly to `LedgerSpec` and preserves source spans for future language
server features.

## Requirements

### Core

1. **Semantic and comment preservation.** Formatting a valid Ledger file _MUST_
   produce output whose parsed `LedgerSpec` and ordered sequence of comments are
   equivalent to the input. A bug in formatting _MUST NOT_ overwrite a file on
   disk with semantically altered accounting data or dropped comments.
2. **Idempotency.** Formatting already-formatted output with the same options
   _MUST_ produce byte-for-byte identical text
   (`format(format(x)) === format(x)`).
3. **Single grammar source of truth.** The syntax parser and the formatter
   _MUST_ share one lexical and syntactic definition so new directives,
   operators, or rule constructs cannot silently diverge between validation and
   formatting.
4. **Pure library boundary.** The formatting engine _MUST_ operate purely in
   memory (`string -> Either<FormatError, string>`) without filesystem or
   process dependencies so it can run in CLI commands, language servers, and
   browser-hosted editor extensions.
5. **Backwards compatibility.** `parse(contents)` in `lib/parsing/parser.ts`
   _MUST_ preserve its existing signature, `LedgerSpec` output, and error
   reporting behavior.

### User

1. **Comment retention and placement.** Standalone comments, inline end-of-line
   comments, comments inside rule blocks or expressions, and trailing
   end-of-file comments _MUST_ be preserved in their logical positions with
   consistent indentation.
2. **Configurable amount alignment.** Users _MUST_ be able to choose both the
   alignment scope (`none`, `directive`, `file`, `file-grow-only`, or `fixed`)
   and the alignment mode (`currency`, `decimal`, or `decimal-and-currency`),
   including diff-friendly whole-file alignment where later directives do not
   widen earlier ones.
3. **Configurable lexical formatting.** Users _MUST_ be able to preserve, add,
   or remove integer thousands separators without altering numeric values or
   written decimal precision, and optionally normalize `txn` versus `*`,
   `currency` versus `commodity`, trailing commas in rule blocks, and aligned
   inline comments.
4. **Escape hatch.** Users _MUST_ be able to disable formatting for regions of a
   file via `; ledger-fmt: off` and `; ledger-fmt: on` comment pragmas.
5. **Editor and CI ergonomics.** The CLI _MUST_ support `stdin`/`stdout` piping,
   in-place `--write`, non-zero `--check` verification for CI, and automatic
   `.ledgerfmt.json` discovery.

## Proposal

### Architecture and module boundaries

We split syntax representation from semantic spec lowering and introduce a pure
`lib/formatting/` module alongside a `cli/fmt.ts` command:

```text
Source text
  └─ lib/syntax/          → lossless RichToken stream + SyntaxTree (CST + spans)
       ├─ lib/parsing/    → lower SyntaxTree to LedgerSpec (existing public API)
       └─ lib/formatting/ → lower SyntaxTree to Doc IR + AlignRows → formatted string
            └─ cli/fmt.ts → stdin/stdout, --write, --check, .ledgerfmt.json
```

- `lib/syntax/` owns tokenization, trivia attachment, `SourceSpan` types,
  concrete syntax tree nodes, resilient error-recovery combinators, and both
  strict (`parseSyntax`) and resilient (`parseSyntaxResilient`) entry points.
- `lib/parsing/` becomes a thin, stateless lowering pass from `SyntaxTree` to
  `LedgerSpec`, preserving its existing `parse(contents)` contract.
- `lib/formatting/` converts `SyntaxTree` nodes into a Wadler–Lindig document IR
  extended with two-dimensional alignment rows, renders the formatted text, and
  verifies semantic and comment preservation before returning.
- `cli/fmt.ts` handles filesystem discovery of `.ledgerfmt.json`, CLI flag
  overrides, `stdin`/`stdout` streaming, `--check` exit codes, and atomic
  `--write` updates.

### Lossless lexing, trivia attachment, and source spans

Every CST token and syntax node records a complete `SourceSpan` containing
0-based UTF-16 character offsets (`offset`) and 1-based line/column coordinates
(`row`, `col`) for both `start` and `end`.

The lexer in `lib/syntax/` matches the existing token patterns using
longest-match priority, with two extensions:

1. **Unrecognized character fallback.** Instead of throwing immediately on an
   unlexable character sequence, the raw lexer emits a `TokenKind.Unknown` token
   capturing the offending text and position. Strict parsing converts `Unknown`
   tokens into the existing `"Unable to tokenize the rest of the input: ..."`
   error, while resilient parsing wraps them in `ErrorCst` nodes.
2. **Trivia attachment pass.** Spaces, newlines, and `;` comments are retained
   during raw lexing and attached to adjacent real tokens (plus `eofTrivia` on
   `SyntaxTree` for trailing comments after the last token):
   - A `;` comment with **no preceding newline** since the previous real token
     is attached to that previous token as `trailingComment`.
   - Newline runs and `;` comments preceded by **at least one newline** are
     attached in source order to the next real token as `leadingTrivia`,
     recording intentional blank lines
     (`blankLines = Math.max(0, newlines - 1)`) before each comment and before
     the token itself.

Because each `RichToken` implements `typescript-parsec`'s `Token<TokenKind>`
interface whose `.next` pointer skips trivia, grammar combinators remain clean
and whitespace-insensitive while retaining every comment and blank line.

### Concrete syntax tree and resilient error recovery

The CST mirrors all nine Ledger directives (`account-rule`, `balance`, `close`,
`currency`/`commodity`, `load`, `option`, `open`, `price`, and `transaction`)
while preserving syntactic details that `LedgerSpec` discards:

- **Raw literals and keywords:** `NumberLiteralCst` stores the raw token string
  (such as `"1,000.00"` or `"0."`); transactions store the exact flag/keyword
  token (`txn`, `*`, or `!`); currency directives store `currency` or
  `commodity`.
- **Parentheses and operator tokens:** `ParenExpressionCst` and
  `ParenConditionCst` preserve explicit user parentheses alongside binary and
  unary operator tokens.
- **Source ordering and punctuation tokens:** Metadata blocks store an ordered
  `readonly MetadataEntryCst[]` (preserving duplicate keys if written); cost
  specifications store `readonly CostItemCst[]` in written order along with
  brace and comma tokens; rule blocks store clause, comma, colon, and brace
  tokens so comments attached to punctuation are never orphaned.

For editor resilience, `parseSyntaxResilient` wraps directive and posting loops
with a custom `recoverUntil` combinator implementing `Parser<TokenKind, T>`.
Because Ledger's grammar does not require directives to start at column 1,
recovery synchronizes purely on token lookahead (`isDirectiveStart`):

- Undated keywords `'account-rule'`, `'load'`, or `'option'`; or
- `DateLiteral` immediately followed by `'txn'`, `'*'`, `'!'`, `'balance'`,
  `'close'`, `'currency'`, `'commodity'`, `'open'`, or `'price'`.

### Layout engine and two-dimensional amount alignment

Standard Wadler–Lindig pretty-printing (`text`, `line`, `softline`, `hardline`,
`indent`, `group`, `ifBreak`, `lineSuffix`, `breakParent`) handles
one-dimensional line wrapping within `printWidth` (default `88` columns) for
boolean conditions, arithmetic expressions, cost specifications, and inline
`choose account` rule blocks.

To support Ledger's tabular alignment across transaction postings and `balance`
assertion entries, the `Doc` IR includes an `AlignRowDoc` node that decomposes
an entry's amount into three parts:

- `left`: indentation, optional posting flag, and account name (for example,
  `"  Assets:Checking"`).
- `intPart`: the formatted integer prefix or non-decimal expression (for
  example, `"-1,100"`, `"100"`, or `"(50 * 20)"`).
- `fracPart`: the decimal point and fractional digits when the amount is a plain
  or unary-signed number literal with a decimal point (for example, `".50"` or
  `"."`), or `""` otherwise.
- `currency`: the currency identifier (for example, `"CHF"`).
- `suffix`: optional cost specification, price annotation, or `~ <tolerance>`.
- `trailingComment`: optional end-of-line `;` comment.

Alignment behavior is controlled by two orthogonal settings:

1. **Alignment scope (`alignScope`)**:
   - `'none'`: separates `left` and the amount by `minGapSpaces` (default `2`).
   - `'directive'` _(default)_: computes target column widths across rows within
     each `transaction` or `balance` directive independently.
   - `'file'`: computes one global target width across all alignable rows in the
     file.
   - `'file-grow-only'`: walks directives from top to bottom maintaining a
     monotonic running maximum for the anchor column (and fractional width when
     aligning both decimals and currencies). Appending a wider directive near
     the bottom of a chronological journal widens only from that directive
     downward, avoiding noisy `git diff` churn in earlier entries while
     remaining completely stateless and idempotent.
   - `'fixed'`: pins the alignment anchor to `alignColumn` (default `52` when
     `'fixed'`), overflowing gracefully with `minGapSpaces` when an account name
     exceeds the target column.

   In `'file'` and `'file-grow-only'` scopes, an optional `maxAlignColumn` cap
   allows unusually long outlier account names to overflow locally with
   `minGapSpaces` rather than pushing the target column outward for the rest of
   the file.

2. **Alignment mode (`alignMode`)**:
   - `'currency'` _(default)_: right-aligns `intPart + fracPart` so currency
     codes start in the same column:

     ```text
     2026-05-01 * "Currency-aligned"
       Assets:Checking     -1,100.50 CHF
       Expenses:Groceries        100 CHF
       Expenses:Split      (50 * 20) CHF
     ```

   - `'decimal'`: aligns the decimal point position (aligning integers and
     parenthesized/binary expressions at the ones-place immediately left of `.`)
     and places the currency after a single space:

     ```text
     2026-05-01 * "Decimal-aligned"
       Assets:Checking     -1,100.50 CHF
       Expenses:Groceries     100 CHF
       Expenses:Split     (50 * 20) CHF
     ```

   - `'decimal-and-currency'`: aligns **both** the decimal point and the
     currency column by padding shorter `fracPart` strings to the maximum
     fractional width within the active scope:

     ```text
     2026-05-01 * "Decimal-and-currency-aligned"
       Assets:Checking     -1,100.50 CHF
       Expenses:Groceries     100    CHF
       Expenses:Split     (50 * 20)  CHF
     ```

### Directives, expressions, and rule-block formatting

- **Top-level directives and blank lines:** Single-line directives (`open`,
  `close`, `currency`, `commodity`, `option`, `load`, `price`, and header-only
  transactions) preserve `0` versus `1` blank line between adjacent directives
  so authors can group related declarations tightly, while collapsing multiple
  blank lines to `1`. Whenever either adjacent directive spans multiple lines
  (contains postings, balance entries, metadata, or a multi-line rule block), at
  least `1` blank line is emitted between them.
- **Dates:** Formatted canonically as `YYYY-MM-DD`, `YYYY-MM-DD hh:mm[:ss]`, or
  `YYYY-MM-DD hh:mm[:ss] <timezone>`.
- **Transactions and `balance` directives:** Transaction postings and `balance`
  assertion entries are always formatted one per indented line (`indentWidth`,
  default `2` spaces), with posting metadata indented two levels
  (`2 * indentWidth`).
- **Rule blocks (`account-rule` and `choose account`):** Top-level
  `account-rule` blocks expand across multiple lines when they contain multiple
  clauses, comments, or exceed `printWidth`. Inline `choose account { ... }`
  blocks stay on a single line if they have a single short clause without
  comments and were not written multi-line, or expand cleanly otherwise. Long
  `when <condition>: <outcome>` clauses wrap after `:` or across `or`/`and`
  boundaries with hanging indentation.
- **Cost and price specifications:** `{}` renders without interior spaces;
  non-empty `{ a, b }` and `{{ a, b }}` include single interior brace spaces and
  comma-and-space item separators, wrapping across indented lines only if
  exceeding `printWidth`. Price annotations render as `@ <amount>` or
  `@@ <amount>`.
- **Expressions:** Binary operators (`+`, `-`, `*`, `/`, `==`, `!=`, `<`, `<=`,
  `>`, `>=`, `is`, `is not`, `and`, `or`) use single spaces on both sides; unary
  `+`/`-` attach directly to literals and parenthesized expressions (`-10`,
  `-(1 + 2)`), while unary `not` uses a trailing space (`not foo == 1`).

### Configurable options and configuration discovery

Configuration is resolved from a `.ledgerfmt.json` file (searched upward from
the target file's directory, or specified via `--config`) and overridden by
explicit CLI flags:

| Option                  | Type                                                             | Default       | Description                                                                   |
| ----------------------- | ---------------------------------------------------------------- | ------------- | ----------------------------------------------------------------------------- |
| `indentWidth`           | `number`                                                         | `2`           | Spaces per indentation level.                                                 |
| `printWidth`            | `number`                                                         | `88`          | Target maximum line width for wrappable constructs.                           |
| `alignScope`            | `'none' \| 'directive' \| 'file' \| 'file-grow-only' \| 'fixed'` | `'directive'` | Scope over which amount alignment columns are computed.                       |
| `alignMode`             | `'currency' \| 'decimal' \| 'decimal-and-currency'`              | `'currency'`  | Which components of an amount align vertically.                               |
| `alignColumn`           | `number`                                                         | `0` / `52`    | Target 1-based anchor column in `'fixed'` scope (`52`), or floor (`0` = off). |
| `maxAlignColumn`        | `number \| null`                                                 | `null`        | Optional maximum anchor column cap for `'file'` and `'file-grow-only'`.       |
| `minGapSpaces`          | `number`                                                         | `2`           | Minimum spaces between an account name and its amount.                        |
| `alignTrailingComments` | `boolean`                                                        | `false`       | Align inline `;` comments vertically across sibling rows in a directive.      |
| `thousandsSeparator`    | `'preserve' \| 'add' \| 'remove'`                                | `'preserve'`  | Preserve, insert, or strip `,` in the integer part of number literals.        |
| `transactionFlagStyle`  | `'preserve' \| 'star' \| 'txn'`                                  | `'preserve'`  | Preserve or normalize `txn` versus `*` on non-`!` transactions.               |
| `currencyKeywordStyle`  | `'preserve' \| 'currency' \| 'commodity'`                        | `'preserve'`  | Preserve or normalize `currency` versus `commodity` directives.               |
| `trailingComma`         | `'multiline' \| 'always' \| 'never'`                             | `'multiline'` | Control trailing commas in `account-rule` and `choose account` blocks.        |

Thousands-separator formatting operates purely on the lexical characters of
`NumberLiteral` tokens—splitting on `.`, stripping or grouping integer digits in
threes, and reattaching the exact fractional suffix—so exact values and trailing
zeroes (`.00`, `.`) are never altered.

### Comment, blank-line, and pragma handling

- **Comment spacing:** Single-semicolon comments without leading whitespace
  (`;note`) are normalized to `; note`. Empty comments (`;`), repeated semicolon
  headers (`;;`, `;;;`), and banner comments remain intact; trailing horizontal
  whitespace inside comments is trimmed.
- **Mandatory line breaks:** Because `;` comments run to the end of the line,
  every emitted comment forces a newline (`hardline` or `lineSuffix` +
  `breakParent`) so subsequent tokens can never be commented out inadvertently.
- **Ignore pragmas:** Top-level standalone comments matching `; ledger-fmt: off`
  suspend formatting for subsequent directives until a matching
  `; ledger-fmt: on` comment (or EOF), replaying the exact raw source slice
  `[start.offset, end.offset]` verbatim.

### Safety invariants

Before `format()` returns formatted text, it runs a fast in-memory verification
pass (skipped only when raw unformatted errors reject the input upfront):

1. Re-parse both input and formatted output to `LedgerSpec` and assert deep
   semantic equality across all directives, `ExactNumber` values, accounts,
   dates, rules, and metadata.
2. Extract all `;` comments in order from both token streams (after normalized
   comment-space trimming) and assert exact 1-to-1 preservation.

If either invariant ever fails, `format()` returns a `Left(FormatError)` rather
than emitting corrupted output, ensuring `ledger fmt --write` never mutates a
file destructively.

### CLI command and editor integration

We add `fmt` to `cli/app.ts`:

```bash
ledger fmt [files...] [--write] [--check] [--stdin-filepath PATH] [--config PATH] [options...]
```

- **Standard I/O mode (`ledger fmt` or `ledger fmt -`):** Reads from `stdin` and
  writes formatted Ledger text to `stdout`, using `--stdin-filepath` (when
  supplied by an editor) to locate the nearest `.ledgerfmt.json`. This
  integrates directly with Vim (`formatprg`), Neovim (`conform.nvim`), Helix,
  and Emacs.
- **Write mode (`--write` / `-w`):** Formats one or more files in place, writing
  to disk only when the formatted content differs from the current file.
- **Check mode (`--check` / `-c`):** Verifies that all target files are already
  formatted, reporting unformatted file paths and exiting with status `1` for CI
  and git hooks.
- **Future language server / VS Code integration:** Because `lib/syntax/`
  attaches full UTF-16 `SourceSpan`s and supports resilient recovery while
  `lib/formatting/` is pure, a future `ledger lsp` command or VS Code extension
  can compute minimal line-level `TextEdit[]` diffs from `format()` alongside
  hover balances and completions backed by `lib/loading/` and `lib/booking/`.

## Design decisions

### Share one grammar via a concrete syntax tree and lowering pass

`lib/syntax/` parses source text into a lossless `SyntaxTree` (CST), and
`lib/parsing/` lowers that `SyntaxTree` into `LedgerSpec`. Both
validation/booking and formatting consume the exact same grammar rules.

#### Rejected alternative: Format directly from `LedgerSpec`

`LedgerSpec` intentionally discards comments, blank lines, raw numeric strings,
explicit parentheses, metadata ordering, and cost-item ordering. Reconstructing
source files from `LedgerSpec` would destroy user comments and rewrite number
precision.

#### Rejected alternative: Maintain a separate parser for the formatter

Writing an independent formatter parser while keeping `lib/parsing/` separate
would duplicate all directive, expression, and `choose account` productions,
creating an ongoing risk that newly added syntax parses in `ledger validate` but
fails or misformats in `ledger fmt`.

#### Rejected alternative: Side-table comment attachment over `LedgerSpec`

Prettier-style side-table comment attachment requires full start/end byte spans
on every AST sub-node and still loses raw numeric strings, parentheses, and
unordered map/cost items unless `LedgerSpec` itself is polluted with formatting
concerns that booking does not want.

### Evolve `typescript-parsec` with trivia tokens and custom recovery combinators

We retain `typescript-parsec` combinators over a `RichToken` stream whose
`.next` chain skips trivia while preserving `leadingTrivia` and
`trailingComment` on each token, paired with `TokenKind.Unknown` and a small
custom `recoverUntil` combinator implementing `Parser<TokenKind, T>` for
resilient parsing.

#### Rejected alternative: Rely solely on built-in `err` and `errd` combinators

In `typescript-parsec`, `err` still fails the enclosing sequence, and `errd`
injects a fallback result without advancing `nextToken` (`nextToken === token`).
As a result, `errd` can recover from a missing expected token, but cannot skip
past unexpected or half-typed tokens without stalling before `EOF`.

#### Rejected alternative: Rewrite the parser from scratch as handwritten recursive descent

A handwritten recursive-descent parser would also support CST construction and
error recovery, and remains easy to swap behind `parseSyntax` later if ever
needed. However, adapting the existing concise `typescript-parsec` grammar
achieves both lossless CST output and token-synchronized recovery with much less
churn.

### Keep the formatter inside the main repository and CLI

`lib/syntax/`, `lib/formatting/`, and `cli/fmt.ts` live inside this monorepo and
ship under the single `ledger` CLI binary (`ledger fmt`).

#### Rejected alternative: Publish a standalone formatter repository or binary

Splitting the formatter into a separate repository or tool would fragment
installation, require cross-repo version coordination on every syntax change
(such as `account-rule` outcomes), and duplicate work needed by future IDE
features (hover balances, inferred amounts, and completions) that require both
syntax spans and the `lib/booking/` engine in one process.

### Extend Wadler-Lindig layout with orthogonal alignment scopes and modes

Decomposing amount layout into `alignScope` (`none`, `directive`, `file`,
`file-grow-only`, `fixed`) and `alignMode` (`currency`, `decimal`,
`decimal-and-currency`) over `(intPart, fracPart, currency)` sub-columns covers
Ledger, hledger, and Beancount conventions uniformly, including arithmetic
expressions.

#### Rejected alternative: Fixed single alignment column only

A fixed column (such as Beancount's column 52) leaves excessive whitespace in
journals with short account names and overflows awkwardly in journals with deep
account hierarchies unless configured per project.

#### Rejected alternative: Whole-file alignment without a monotonic grow-only mode

Standard whole-file alignment recomputes one column from the widest directive in
the file; adding a single wide entry at the bottom of a chronological journal
re-indents every earlier transaction, creating noisy git diffs. Supporting
`file-grow-only` via a top-to-bottom running maximum eliminates backward diffs
while staying stateless and idempotent.

### Load formatter settings from `.ledgerfmt.json` and CLI flags

Formatting options are configured via `.ledgerfmt.json` files and CLI flags,
without reading Ledger `option` directives.

#### Rejected alternative: Configure formatting through in-file `option` directives

In Ledger, `option` directives are positional and scoped to `load` evaluation
frames across multiple files. Tying formatting to `option` evaluation would make
single-file editor formatting (`stdin`) depend on cross-file `load` graphs and
mix presentation preferences into accounting journals.

### Canonicalize whitespace, date spacing, and multi-line `balance` entries while preserving value precision

The formatter normalizes structural whitespace—emitting each `balance` assertion
entry on its own indented line just like transaction postings, normalizing date
components to single-space separation, and collapsing multiple blank lines—while
never rounding or re-scaling numeric precision.

#### Rejected alternative: Round or pad decimals using `currency` `format-decimals` metadata

`format-decimals` controls report display rounding across loaded files, whereas
source formatting is file-local and lossless. Automatically padding or rounding
authored postings could alter explicit lot costs or fail when `currency`
declarations live in another `load`ed file.

#### Rejected alternative: Keep single-entry `balance` directives inline

Allowing single-entry `balance` directives to remain on the header line while
multi-entry `balance` directives break onto indented lines would prevent
`balance` amounts from aligning vertically with surrounding transaction postings
in `file`, `file-grow-only`, and `fixed` scopes.
