import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  boolean,
  command,
  flag,
  number,
  oneOf,
  option,
  optional,
  restPositionals,
  string,
} from 'cmd-ts';
import { either as E } from 'fp-ts';

import {
  ALIGN_MODES,
  ALIGN_SCOPES,
  AlignMode,
  AlignScope,
  CURRENCY_KEYWORD_STYLES,
  CurrencyKeywordStyle,
  DEFAULT_FORMAT_OPTIONS,
  format,
  FormatOptions,
  resolveFormatOptions,
  THOUSANDS_SEPARATOR_MODES,
  ThousandsSeparatorMode,
  TRAILING_COMMA_STYLES,
  TrailingCommaStyle,
  TRANSACTION_FLAG_STYLES,
  TransactionFlagStyle,
} from '../lib/formatting/formatter.js';
import { CommandError } from './error.js';

export const CONFIG_FILENAME = '.ledgerfmt.json';

export interface FmtCliArgs {
  readonly files: readonly string[];
  readonly write: boolean;
  readonly check: boolean;
  readonly config?: string;
  readonly stdinFilepath?: string;
  readonly indentWidth?: number;
  readonly printWidth?: number;
  readonly alignScope?: AlignScope;
  readonly alignMode?: AlignMode;
  readonly alignColumn?: number;
  readonly maxAlignColumn?: number;
  readonly minGapSpaces?: number;
  readonly alignTrailingComments?: boolean;
  readonly thousandsSeparator?: ThousandsSeparatorMode;
  readonly transactionFlagStyle?: TransactionFlagStyle;
  readonly currencyKeywordStyle?: CurrencyKeywordStyle;
  readonly trailingComma?: TrailingCommaStyle;
}

export interface FmtIo {
  readonly cwd: () => string;
  readonly readStdin: () => Promise<string>;
  readonly writeStdout: (text: string) => void;
}

async function readAllStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(
      typeof chunk === 'string'
        ? Buffer.from(chunk, 'utf8')
        : (chunk as Buffer),
    );
  }
  return Buffer.concat(chunks).toString('utf8');
}

const DEFAULT_FMT_IO: FmtIo = {
  cwd: () => process.cwd(),
  readStdin: readAllStdin,
  writeStdout: text => {
    process.stdout.write(text);
  },
};

/**
 * Searches upward from `startDir` for the nearest `.ledgerfmt.json` file.
 *
 * @param startDir Directory from which to begin searching upward.
 * @returns Absolute path to `.ledgerfmt.json`, or `null` if none is found.
 */
export function discoverConfigPath(startDir: string): string | null {
  let current = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(current, CONFIG_FILENAME);
    try {
      const stat = fs.statSync(candidate);
      if (stat.isFile()) {
        return candidate;
      }
    } catch {
      // Ignore missing or inaccessible entries while walking upward.
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function loadConfigFile(
  configPath: string,
): E.Either<CommandError, Partial<FormatOptions>> {
  let rawText: string;
  try {
    rawText = fs.readFileSync(configPath, 'utf8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return E.left(
      new CommandError(
        `Failed to read formatter config '${configPath}': ${msg}`,
        { cause: err },
      ),
    );
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawText);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return E.left(
      new CommandError(
        `Invalid JSON in formatter config '${configPath}': ${msg}`,
        { cause: err },
      ),
    );
  }

  const validated = resolveFormatOptions(parsedJson);
  if (E.isLeft(validated)) {
    return E.left(
      new CommandError(
        `Invalid formatter config '${configPath}': ${validated.left.message}`,
        { cause: validated.left },
      ),
    );
  }

  return E.right(parsedJson as Partial<FormatOptions>);
}

function extractCliOverrides(args: FmtCliArgs): Partial<FormatOptions> {
  const overrides: Record<string, unknown> = {};
  if (args.indentWidth !== undefined) {
    overrides.indentWidth = args.indentWidth;
  }
  if (args.printWidth !== undefined) {
    overrides.printWidth = args.printWidth;
  }
  if (args.alignScope !== undefined) {
    overrides.alignScope = args.alignScope;
  }
  if (args.alignMode !== undefined) {
    overrides.alignMode = args.alignMode;
  }
  if (args.alignColumn !== undefined) {
    overrides.alignColumn = args.alignColumn;
  }
  if (args.maxAlignColumn !== undefined) {
    overrides.maxAlignColumn = args.maxAlignColumn;
  }
  if (args.minGapSpaces !== undefined) {
    overrides.minGapSpaces = args.minGapSpaces;
  }
  if (args.alignTrailingComments !== undefined) {
    overrides.alignTrailingComments = args.alignTrailingComments;
  }
  if (args.thousandsSeparator !== undefined) {
    overrides.thousandsSeparator = args.thousandsSeparator;
  }
  if (args.transactionFlagStyle !== undefined) {
    overrides.transactionFlagStyle = args.transactionFlagStyle;
  }
  if (args.currencyKeywordStyle !== undefined) {
    overrides.currencyKeywordStyle = args.currencyKeywordStyle;
  }
  if (args.trailingComma !== undefined) {
    overrides.trailingComma = args.trailingComma;
  }
  return overrides as Partial<FormatOptions>;
}

/**
 * Runs the `ledger fmt` workflow over `stdin` or explicit file paths.
 *
 * @param args Parsed CLI flags, options, and target file arguments.
 * @param io Injectable I/O callbacks for `cwd`, `stdin`, and `stdout`.
 * @returns `Right(undefined)` on success, or a `CommandError` on failure.
 */
export async function runFmt(
  args: FmtCliArgs,
  io: FmtIo = DEFAULT_FMT_IO,
): Promise<E.Either<CommandError, void>> {
  if (args.write && args.check) {
    return E.left(new CommandError('Cannot specify both --write and --check'));
  }

  const useStdin =
    args.files.length === 0 ||
    (args.files.length === 1 && args.files[0] === '-');

  if (!useStdin && args.files.includes('-')) {
    return E.left(new CommandError("Cannot mix '-' (stdin) with file paths"));
  }

  if (useStdin && args.write) {
    return E.left(
      new CommandError('Cannot use --write when reading from standard input'),
    );
  }

  if (!useStdin && !args.write && !args.check && args.files.length > 1) {
    return E.left(
      new CommandError(
        'Cannot write multiple formatted files to standard output; pass --write or --check',
      ),
    );
  }

  const cliOverrides = extractCliOverrides(args);
  const configCache = new Map<string, Partial<FormatOptions>>();

  const resolveOptionsForDir = (
    startDir: string,
  ): E.Either<CommandError, FormatOptions> => {
    const configPath =
      args.config !== undefined
        ? path.resolve(io.cwd(), args.config)
        : discoverConfigPath(startDir);

    let fileOpts: Partial<FormatOptions> = {};
    if (configPath !== null) {
      const cached = configCache.get(configPath);
      if (cached !== undefined) {
        fileOpts = cached;
      } else {
        const loaded = loadConfigFile(configPath);
        if (E.isLeft(loaded)) {
          return loaded;
        }
        fileOpts = loaded.right;
        configCache.set(configPath, fileOpts);
      }
    }

    const merged = {
      ...DEFAULT_FORMAT_OPTIONS,
      ...fileOpts,
      ...cliOverrides,
    };
    const resolved = resolveFormatOptions(merged);
    if (E.isLeft(resolved)) {
      return E.left(
        new CommandError(resolved.left.message, { cause: resolved.left }),
      );
    }
    return resolved;
  };

  if (useStdin) {
    const startDir =
      args.stdinFilepath !== undefined
        ? path.dirname(path.resolve(io.cwd(), args.stdinFilepath))
        : io.cwd();
    const resolvedOpts = resolveOptionsForDir(startDir);
    if (E.isLeft(resolvedOpts)) {
      return resolvedOpts;
    }

    const label = args.stdinFilepath ?? '<stdin>';
    let contents: string;
    try {
      contents = await io.readStdin();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return E.left(
        new CommandError(`Failed to read from standard input: ${msg}`, {
          cause: err,
        }),
      );
    }

    const formatted = format(contents, resolvedOpts.right);
    if (E.isLeft(formatted)) {
      return E.left(CommandError.fromFormatError(formatted.left, label));
    }

    if (args.check) {
      if (formatted.right !== contents) {
        return E.left(
          new CommandError(
            `The following files are not formatted:\n  ${label}`,
          ),
        );
      }
      return E.right(undefined);
    }

    io.writeStdout(formatted.right);
    return E.right(undefined);
  }

  const unformattedFiles: string[] = [];

  for (const fileArg of args.files) {
    const resolvedPath = path.resolve(io.cwd(), fileArg);
    const resolvedOpts = resolveOptionsForDir(path.dirname(resolvedPath));
    if (E.isLeft(resolvedOpts)) {
      return resolvedOpts;
    }

    let contents: string;
    try {
      contents = await fs.promises.readFile(resolvedPath, 'utf8');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return E.left(
        new CommandError(`Failed to read '${fileArg}': ${msg}`, { cause: err }),
      );
    }

    const formatted = format(contents, resolvedOpts.right);
    if (E.isLeft(formatted)) {
      return E.left(CommandError.fromFormatError(formatted.left, fileArg));
    }

    if (args.check) {
      if (formatted.right !== contents) {
        unformattedFiles.push(fileArg);
      }
    } else if (args.write) {
      if (formatted.right !== contents) {
        try {
          await fs.promises.writeFile(resolvedPath, formatted.right, 'utf8');
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return E.left(
            new CommandError(`Failed to write '${fileArg}': ${msg}`, {
              cause: err,
            }),
          );
        }
      }
    } else {
      io.writeStdout(formatted.right);
    }
  }

  if (args.check && unformattedFiles.length > 0) {
    return E.left(
      new CommandError(
        [
          'The following files are not formatted:',
          ...unformattedFiles.map(f => `  ${f}`),
        ].join('\n'),
      ),
    );
  }

  return E.right(undefined);
}

export const fmt = command({
  name: 'fmt',
  description: 'Formats ledger files',
  args: {
    files: restPositionals({
      displayName: 'files',
      type: string,
      description:
        'Ledger files to format (reads from stdin if omitted or "-")',
    }),
    write: flag({
      long: 'write',
      short: 'w',
      description: 'Format files in place',
    }),
    check: flag({
      long: 'check',
      short: 'c',
      description: 'Check if inputs are formatted without modifying files',
    }),
    config: option({
      long: 'config',
      type: optional(string),
      description: `Path to ${CONFIG_FILENAME} configuration file`,
    }),
    stdinFilepath: option({
      long: 'stdin-filepath',
      type: optional(string),
      description:
        'File path used for config discovery and diagnostics when reading from stdin',
    }),
    indentWidth: option({
      long: 'indent-width',
      type: optional(number),
      description: 'Spaces per indentation level',
    }),
    printWidth: option({
      long: 'print-width',
      type: optional(number),
      description: 'Target maximum line width for wrappable constructs',
    }),
    alignScope: option({
      long: 'align-scope',
      type: optional(oneOf([...ALIGN_SCOPES])),
      description: 'Scope over which amounts are aligned',
    }),
    alignMode: option({
      long: 'align-mode',
      type: optional(oneOf([...ALIGN_MODES])),
      description: 'Which components of amounts align vertically',
    }),
    alignColumn: option({
      long: 'align-column',
      type: optional(number),
      description:
        'Target 1-based anchor column in fixed scope, or minimum floor column',
    }),
    maxAlignColumn: option({
      long: 'max-align-column',
      type: optional(number),
      description:
        'Maximum anchor column cap for file and file-grow-only scopes',
    }),
    minGapSpaces: option({
      long: 'min-gap-spaces',
      type: optional(number),
      description: 'Minimum spaces between an account name and its amount',
    }),
    alignTrailingComments: flag({
      long: 'align-trailing-comments',
      type: optional(boolean),
      description:
        'Align inline trailing comments across sibling rows in a directive',
    }),
    thousandsSeparator: option({
      long: 'thousands-separator',
      type: optional(oneOf([...THOUSANDS_SEPARATOR_MODES])),
      description: 'Preserve, add, or remove thousands separators in numbers',
    }),
    transactionFlagStyle: option({
      long: 'transaction-flag-style',
      type: optional(oneOf([...TRANSACTION_FLAG_STYLES])),
      description: 'Preserve or normalize transaction flags (* vs txn)',
    }),
    currencyKeywordStyle: option({
      long: 'currency-keyword-style',
      type: optional(oneOf([...CURRENCY_KEYWORD_STYLES])),
      description: 'Preserve or normalize currency vs commodity keywords',
    }),
    trailingComma: option({
      long: 'trailing-comma',
      type: optional(oneOf([...TRAILING_COMMA_STYLES])),
      description:
        'Control trailing commas in account-rule and choose account blocks',
    }),
  },
  handler: async (args): Promise<E.Either<CommandError, void>> => {
    return runFmt(args);
  },
});
