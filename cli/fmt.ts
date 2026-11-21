import * as fs from 'node:fs';
import * as path from 'node:path';

import { writeFile as writeFileAtomic } from 'atomically';
import {
  boolean,
  command,
  flag,
  oneOf,
  option,
  optional,
  restPositionals,
  string,
  Type,
} from 'cmd-ts';
import { either as E } from 'fp-ts';

import {
  ALIGN_MODES,
  ALIGN_SCOPES,
  AlignMode,
  AlignScope,
  COST_SPEC_WRAP_STYLES,
  CostSpecWrapStyle,
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
import { CommandError, sanitizeTerminalText } from './error.js';

export const CONFIG_FILENAME = '.ledgerfmt.json';

const VCS_ROOT_MARKERS = ['.git', '.hg'] as const;

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
  readonly maxAlignColumn?: number | null;
  readonly minGapSpaces?: number;
  readonly alignTrailingComments?: boolean;
  readonly thousandsSeparator?: ThousandsSeparatorMode;
  readonly transactionFlagStyle?: TransactionFlagStyle;
  readonly currencyKeywordStyle?: CurrencyKeywordStyle;
  readonly trailingComma?: TrailingCommaStyle;
  readonly costSpecWrapStyle?: CostSpecWrapStyle;
}

export interface FmtIo {
  readonly cwd: () => string;
  readonly readStdin: () => Promise<string>;
  readonly writeStdout: (text: string) => void;
}

const UTF8_DECODER = new TextDecoder('utf-8', {
  fatal: true,
  ignoreBOM: true,
});

const UTF8_CONFIG_DECODER = new TextDecoder('utf-8', {
  fatal: true,
  ignoreBOM: false,
});

function decodeStrictUtf8(buffer: Buffer): string {
  return UTF8_DECODER.decode(buffer);
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
  return decodeStrictUtf8(Buffer.concat(chunks));
}

const DEFAULT_FMT_IO: FmtIo = {
  cwd: () => process.cwd(),
  readStdin: readAllStdin,
  writeStdout: text => {
    process.stdout.write(text);
  },
};

function hasVcsMarker(dir: string): boolean {
  for (const marker of VCS_ROOT_MARKERS) {
    try {
      fs.lstatSync(path.join(dir, marker));
      return true;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      // Stop climbing if the directory cannot be traversed.
      if (code === 'EACCES' || code === 'EPERM') {
        return true;
      }
    }
  }
  return false;
}

function isUntrustedDir(dir: string): boolean {
  try {
    const stat = fs.statSync(dir);
    if (!stat.isDirectory()) {
      return true;
    }
    // Never auto-load config from world-writable directories (e.g. /tmp).
    if ((stat.mode & 0o002) !== 0) {
      return true;
    }
    return false;
  } catch (err) {
    // Allow stepping upward past non-existent virtual --stdin-filepath paths.
    const code = (err as NodeJS.ErrnoException).code;
    return code !== 'ENOENT';
  }
}

/**
 * Searches upward from `startDir` for the nearest `.ledgerfmt.json` file.
 *
 * Stops at VCS repository roots (`.git`, `.hg`), unreadable directories, and
 * world-writable directories.
 *
 * @param startDir Directory from which to begin searching upward.
 * @returns Absolute path to `.ledgerfmt.json`, or `null` if none is found.
 */
export function discoverConfigPath(startDir: string): string | null {
  let current = path.resolve(startDir);

  for (;;) {
    if (isUntrustedDir(current)) {
      return null;
    }

    const candidate = path.join(current, CONFIG_FILENAME);
    try {
      // Return any existing .ledgerfmt.json entry (regular file, symlink,
      // broken symlink, or directory) so loadConfigFile reports invalid or
      // inaccessible entries rather than silently inheriting a parent config.
      fs.lstatSync(candidate);
      return candidate;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EACCES' || code === 'EPERM') {
        return null;
      }
      // Ignore missing entries while walking upward.
    }

    if (hasVcsMarker(current)) {
      return null;
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
  const safePath = sanitizeTerminalText(configPath, undefined, true);
  let rawText: string;
  try {
    rawText = UTF8_CONFIG_DECODER.decode(fs.readFileSync(configPath));
  } catch (err) {
    const msg = sanitizeTerminalText(
      err instanceof Error ? err.message : String(err),
    );
    return E.left(
      new CommandError(
        `Failed to read formatter config '${safePath}': ${msg}`,
        { cause: err },
      ),
    );
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawText);
  } catch (err) {
    const msg = sanitizeTerminalText(
      err instanceof Error ? err.message : String(err),
    );
    return E.left(
      new CommandError(
        `Invalid JSON in formatter config '${safePath}': ${msg}`,
        { cause: err },
      ),
    );
  }

  const validated = resolveFormatOptions(parsedJson);
  if (E.isLeft(validated)) {
    return E.left(
      new CommandError(
        `Invalid formatter config '${safePath}': ${sanitizeTerminalText(validated.left.message)}`,
        { cause: validated.left },
      ),
    );
  }

  const rawRecord = parsedJson as Record<string, unknown>;
  const sanitized: Record<string, unknown> = {};
  for (const key of Object.keys(rawRecord)) {
    sanitized[key] = validated.right[key as keyof FormatOptions];
  }
  return E.right(sanitized as Partial<FormatOptions>);
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
  if (args.costSpecWrapStyle !== undefined) {
    overrides.costSpecWrapStyle = args.costSpecWrapStyle;
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

  if (!useStdin && args.stdinFilepath !== undefined) {
    return E.left(
      new CommandError(
        'Cannot use --stdin-filepath when formatting file paths',
      ),
    );
  }

  if (args.stdinFilepath !== undefined && args.stdinFilepath.trim() === '') {
    return E.left(new CommandError('--stdin-filepath cannot be empty'));
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
        new CommandError(sanitizeTerminalText(resolved.left.message), {
          cause: resolved.left,
        }),
      );
    }
    return resolved;
  };

  if (useStdin) {
    let startDir = io.cwd();
    if (args.stdinFilepath !== undefined) {
      const resolvedStdinPath = path.resolve(io.cwd(), args.stdinFilepath);
      startDir = path.dirname(resolvedStdinPath);
      try {
        if (fs.statSync(resolvedStdinPath).isDirectory()) {
          startDir = resolvedStdinPath;
        }
      } catch {
        // Virtual non-existent path: search starting from its parent directory.
      }
    }
    const resolvedOpts = resolveOptionsForDir(startDir);
    if (E.isLeft(resolvedOpts)) {
      return resolvedOpts;
    }

    const label = args.stdinFilepath ?? '<stdin>';
    let contents: string;
    try {
      contents = await io.readStdin();
    } catch (err) {
      const msg = sanitizeTerminalText(
        err instanceof Error ? err.message : String(err),
      );
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
            `The following files are not formatted:\n  ${sanitizeTerminalText(label, undefined, true)}`,
          ),
        );
      }
      return E.right(undefined);
    }

    io.writeStdout(formatted.right);
    return E.right(undefined);
  }

  const unformattedFiles: string[] = [];
  const pendingWrites: {
    readonly fileArg: string;
    readonly resolvedPath: string;
    readonly content: string;
  }[] = [];
  const seenPaths = new Set<string>();

  for (const fileArg of args.files) {
    const resolvedPath = path.resolve(io.cwd(), fileArg);
    const canonicalPath = await fs.promises
      .realpath(resolvedPath)
      .catch(() => resolvedPath);
    if (seenPaths.has(resolvedPath) || seenPaths.has(canonicalPath)) {
      continue;
    }
    seenPaths.add(resolvedPath);
    seenPaths.add(canonicalPath);

    const resolvedOpts = resolveOptionsForDir(path.dirname(resolvedPath));
    if (E.isLeft(resolvedOpts)) {
      return resolvedOpts;
    }

    let rawBytes: Buffer;
    try {
      rawBytes = await fs.promises.readFile(resolvedPath);
    } catch (err) {
      const msg = sanitizeTerminalText(
        err instanceof Error ? err.message : String(err),
      );
      return E.left(
        new CommandError(
          `Failed to read '${sanitizeTerminalText(fileArg, undefined, true)}': ${msg}`,
          { cause: err },
        ),
      );
    }

    let contents: string;
    try {
      contents = decodeStrictUtf8(rawBytes);
    } catch (err) {
      return E.left(
        new CommandError(
          `Invalid UTF-8 in '${sanitizeTerminalText(fileArg, undefined, true)}'`,
          { cause: err },
        ),
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
        pendingWrites.push({
          fileArg,
          resolvedPath,
          content: formatted.right,
        });
      }
    } else {
      io.writeStdout(formatted.right);
    }
  }

  for (const writeOp of pendingWrites) {
    try {
      await writeFileAtomic(writeOp.resolvedPath, writeOp.content, 'utf8');
    } catch (err) {
      const msg = sanitizeTerminalText(
        err instanceof Error ? err.message : String(err),
      );
      return E.left(
        new CommandError(
          `Failed to write '${sanitizeTerminalText(writeOp.fileArg, undefined, true)}': ${msg}`,
          {
            cause: err,
          },
        ),
      );
    }
  }

  if (args.check && unformattedFiles.length > 0) {
    return E.left(
      new CommandError(
        [
          'The following files are not formatted:',
          ...unformattedFiles.map(
            f => `  ${sanitizeTerminalText(f, undefined, true)}`,
          ),
        ].join('\n'),
      ),
    );
  }

  return E.right(undefined);
}

const STRICT_INT_REGEX = /^-?\d+$/;

const strictIntType: Type<string, number> = {
  async from(raw) {
    if (!STRICT_INT_REGEX.test(raw)) {
      throw new Error(
        `Invalid integer: '${sanitizeTerminalText(raw, undefined, true)}'`,
      );
    }
    const parsed = Number(raw);
    if (!Number.isSafeInteger(parsed)) {
      throw new Error(
        `Invalid integer: '${sanitizeTerminalText(raw, undefined, true)}'`,
      );
    }
    return parsed;
  },
};

const maxAlignColumnType: Type<string, number | null> = {
  async from(raw) {
    if (raw === 'none' || raw === 'null') {
      return null;
    }
    if (!STRICT_INT_REGEX.test(raw)) {
      throw new Error(
        `Invalid integer or 'none': '${sanitizeTerminalText(raw, undefined, true)}'`,
      );
    }
    const parsed = Number(raw);
    if (!Number.isSafeInteger(parsed)) {
      throw new Error(
        `Invalid integer or 'none': '${sanitizeTerminalText(raw, undefined, true)}'`,
      );
    }
    return parsed;
  },
};

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
      type: optional(strictIntType),
      description: 'Spaces per indentation level',
    }),
    printWidth: option({
      long: 'print-width',
      type: optional(strictIntType),
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
      type: optional(strictIntType),
      description:
        'Target 1-based anchor column in fixed scope, or minimum floor column',
    }),
    maxAlignColumn: option({
      long: 'max-align-column',
      type: optional(maxAlignColumnType),
      description:
        'Maximum anchor column cap for file and file-grow-only scopes (or "none" to disable)',
    }),
    minGapSpaces: option({
      long: 'min-gap-spaces',
      type: optional(strictIntType),
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
    costSpecWrapStyle: option({
      long: 'cost-spec-wrap-style',
      type: optional(oneOf([...COST_SPEC_WRAP_STYLES])),
      description:
        'How wrapped cost specs pack items across lines (compact or expanded)',
    }),
  },
  handler: async (args): Promise<E.Either<CommandError, void>> => {
    return runFmt(args);
  },
});
