import { execFile } from 'node:child_process';
import {
  access,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseArgs, promisify } from 'node:util';

import type { BenchReport } from './bench.js';
import {
  compareReports,
  type CompareSummary,
  renderMarkdown,
  renderText,
  type RetryRun,
  validateBenchReport,
} from './compare-bench.js';

const execFileAsync = promisify(execFile);

function parseFiniteNumber(
  raw: string,
  flagName: string,
  options: { readonly min?: number; readonly integer?: boolean },
): number {
  if (raw.trim() === '') {
    throw new Error(`Invalid value for --${flagName}: "${raw}"`);
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid value for --${flagName}: "${raw}"`);
  }
  if (options.integer && !Number.isInteger(value)) {
    throw new Error(`--${flagName} must be an integer, got "${raw}"`);
  }
  if (options.min !== undefined && value < options.min) {
    throw new Error(`--${flagName} must be >= ${options.min}, got "${raw}"`);
  }
  return value;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', [...args], { cwd });
  return stdout.trim();
}

async function tryGit(
  cwd: string,
  args: readonly string[],
): Promise<string | undefined> {
  try {
    return await git(cwd, args);
  } catch {
    return undefined;
  }
}

async function resolveDefaultBeforeRef(
  repoRoot: string,
  afterRef: string,
): Promise<{ readonly ref: string; readonly label: string }> {
  for (const candidate of ['main', 'origin/main']) {
    const exists = await tryGit(repoRoot, [
      'rev-parse',
      '--verify',
      `${candidate}^{commit}`,
    ]);
    if (exists) {
      const mergeBase = await git(repoRoot, [
        'merge-base',
        candidate,
        afterRef,
      ]);
      const shortSha = await git(repoRoot, ['rev-parse', '--short', mergeBase]);
      return {
        ref: mergeBase,
        label: `merge-base(${candidate}) (${shortSha})`,
      };
    }
  }
  throw new Error(
    'Could not find "main" or "origin/main" to compute merge-base. Pass --before=<git-ref> explicitly.',
  );
}

async function prepareWorktree(
  repoRoot: string,
  gitRef: string,
  worktreeName: string,
  tmpDir: string,
): Promise<{ readonly dir: string; readonly shortSha: string }> {
  const shortSha = await git(repoRoot, ['rev-parse', '--short', gitRef]);
  const worktreeDir = path.join(tmpDir, worktreeName);

  await git(repoRoot, ['worktree', 'add', '--detach', worktreeDir, gitRef]);

  // If this ref predates scripts/bench.ts, skip installing dependencies.
  if (!(await fileExists(path.join(worktreeDir, 'scripts', 'bench.ts')))) {
    return { dir: worktreeDir, shortSha };
  }

  const rootLock = path.join(repoRoot, 'package-lock.json');
  const wtLock = path.join(worktreeDir, 'package-lock.json');
  const sameLock =
    (await fileExists(rootLock)) &&
    (await fileExists(wtLock)) &&
    (await readFile(rootLock, 'utf8')) === (await readFile(wtLock, 'utf8'));

  if (sameLock && (await fileExists(path.join(repoRoot, 'node_modules')))) {
    await symlink(
      path.join(repoRoot, 'node_modules'),
      path.join(worktreeDir, 'node_modules'),
      'dir',
    );
  } else {
    console.log(
      `Dependencies differ at ${shortSha}; running npm ci in temporary worktree...`,
    );
    await execFileAsync('npm', ['ci', '--ignore-scripts'], {
      cwd: worktreeDir,
      maxBuffer: 10 * 1024 * 1024,
    });
  }

  return { dir: worktreeDir, shortSha };
}

interface RunBenchOptions {
  readonly timeMs: number;
  readonly iterations: number;
  readonly heavyIterations: number;
  readonly suite?: string;
  readonly filter?: string;
  readonly exactFilter?: string;
  readonly allowEmpty?: boolean;
}

async function runBenchProcess(
  repoDir: string,
  outJsonPath: string,
  options: RunBenchOptions,
): Promise<BenchReport> {
  const tsxBin = path.join(repoDir, 'node_modules', '.bin', 'tsx');
  const args = [
    'scripts/bench.ts',
    '--json',
    outJsonPath,
    '--no-guardrails',
    '--quiet',
    '--time',
    String(options.timeMs),
    '--iterations',
    String(options.iterations),
    '--heavy-iterations',
    String(options.heavyIterations),
  ];
  if (options.suite) {
    args.push('--suite', options.suite);
  }
  if (options.filter) {
    args.push('--filter', options.filter);
  }
  if (options.exactFilter) {
    args.push('--exact-filter', options.exactFilter);
  }
  if (options.allowEmpty) {
    args.push('--allow-empty');
  }

  await execFileAsync(tsxBin, args, {
    cwd: repoDir,
    maxBuffer: 10 * 1024 * 1024,
  });

  const raw = await readFile(outJsonPath, 'utf8');
  return validateBenchReport(JSON.parse(raw) as unknown, outJsonPath);
}

async function runAfterOnlyRounds(
  afterDir: string,
  tmpDir: string,
  rounds: number,
  tag: string,
  options: RunBenchOptions,
): Promise<BenchReport[]> {
  const afterReports: BenchReport[] = [];
  for (let r = 0; r < rounds; r++) {
    console.log(`[${tag}] Round ${r + 1}/${rounds} (after)...`);
    afterReports.push(
      await runBenchProcess(
        afterDir,
        path.join(tmpDir, `${tag}-r${r}-after.json`),
        options,
      ),
    );
  }
  return afterReports;
}

async function runInterleavedRounds(
  beforeDir: string,
  afterDir: string,
  tmpDir: string,
  rounds: number,
  tag: string,
  options: RunBenchOptions,
): Promise<{
  readonly beforeReports: readonly BenchReport[];
  readonly afterReports: readonly BenchReport[];
}> {
  const beforeReports: BenchReport[] = [];
  const afterReports: BenchReport[] = [];
  const beforeOptions: RunBenchOptions = { ...options, allowEmpty: true };

  for (let r = 0; r < rounds; r++) {
    const beforeOut = path.join(tmpDir, `${tag}-r${r}-before.json`);
    const afterOut = path.join(tmpDir, `${tag}-r${r}-after.json`);
    const beforeFirst = r % 2 === 0;

    console.log(
      `[${tag}] Round ${r + 1}/${rounds} (${beforeFirst ? 'before -> after' : 'after -> before'})...`,
    );

    if (beforeFirst) {
      beforeReports.push(
        await runBenchProcess(beforeDir, beforeOut, beforeOptions),
      );
      afterReports.push(await runBenchProcess(afterDir, afterOut, options));
    } else {
      afterReports.push(await runBenchProcess(afterDir, afterOut, options));
      beforeReports.push(
        await runBenchProcess(beforeDir, beforeOut, beforeOptions),
      );
    }
  }

  return { beforeReports, afterReports };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      before: { type: 'string' },
      after: { type: 'string' },
      'before-dir': { type: 'string' },
      'after-dir': { type: 'string' },
      'before-label': { type: 'string' },
      'after-label': { type: 'string' },
      rounds: { type: 'string', default: '3' },
      'round-time': { type: 'string', default: '400' },
      'round-iterations': { type: 'string', default: '5' },
      'heavy-iterations': { type: 'string', default: '2' },
      'warn-threshold': { type: 'string', default: '5' },
      'fail-threshold': { type: 'string', default: '10' },
      retries: { type: 'string', default: '1' },
      suite: { type: 'string' },
      filter: { type: 'string' },
      'markdown-out': { type: 'string' },
      'json-out': { type: 'string' },
    },
    strict: true,
  });

  if (values.before && values['before-dir']) {
    throw new Error('Cannot specify both --before and --before-dir');
  }
  if (values.after && values['after-dir']) {
    throw new Error('Cannot specify both --after and --after-dir');
  }

  const repoRoot = process.cwd();
  const rounds = parseFiniteNumber(values.rounds, 'rounds', {
    min: 1,
    integer: true,
  });
  const warnThresholdPct = parseFiniteNumber(
    values['warn-threshold'],
    'warn-threshold',
    { min: 0 },
  );
  const failThresholdPct = parseFiniteNumber(
    values['fail-threshold'],
    'fail-threshold',
    { min: warnThresholdPct },
  );
  const retries = parseFiniteNumber(values.retries, 'retries', {
    min: 0,
    integer: true,
  });
  const benchOpts: RunBenchOptions = {
    timeMs: parseFiniteNumber(values['round-time'], 'round-time', { min: 1 }),
    iterations: parseFiniteNumber(
      values['round-iterations'],
      'round-iterations',
      { min: 1, integer: true },
    ),
    heavyIterations: parseFiniteNumber(
      values['heavy-iterations'],
      'heavy-iterations',
      { min: 1, integer: true },
    ),
    suite: values.suite,
    filter: values.filter,
  };

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ledger-bench-'));
  const createdWorktrees: string[] = [];
  let cleanupPromise: Promise<void> | undefined;

  const cleanup = (): Promise<void> => {
    if (!cleanupPromise) {
      cleanupPromise = (async () => {
        for (const wtDir of createdWorktrees) {
          try {
            await git(repoRoot, ['worktree', 'remove', '--force', wtDir]);
          } catch {
            // Best-effort cleanup
          }
        }
        await rm(tmpDir, { recursive: true, force: true });
      })();
    }
    return cleanupPromise;
  };

  const onSignal = (exitCode: number): void => {
    void cleanup().finally(() => {
      process.exit(exitCode);
    });
  };
  const onSigInt = () => onSignal(130);
  const onSigTerm = () => onSignal(143);
  process.once('SIGINT', onSigInt);
  process.once('SIGTERM', onSigTerm);

  try {
    let afterDir: string;
    let afterLabel: string;
    if (values['after-dir']) {
      afterDir = path.resolve(values['after-dir']);
      const sha = await tryGit(afterDir, ['rev-parse', '--short', 'HEAD']);
      afterLabel = values['after-label'] ?? (sha ? `after (${sha})` : afterDir);
    } else if (values.after) {
      const wt = await prepareWorktree(
        repoRoot,
        values.after,
        'after-worktree',
        tmpDir,
      );
      createdWorktrees.push(wt.dir);
      afterDir = wt.dir;
      afterLabel = values['after-label'] ?? `${values.after} (${wt.shortSha})`;
    } else {
      afterDir = repoRoot;
      const sha = await tryGit(repoRoot, ['rev-parse', '--short', 'HEAD']);
      const dirty = (await tryGit(repoRoot, ['status', '--porcelain'])) !== '';
      afterLabel =
        values['after-label'] ??
        (sha
          ? `working tree (${sha}${dirty ? '-dirty' : ''})`
          : 'working tree');
    }

    let beforeDir: string;
    let beforeLabel: string;
    if (values['before-dir']) {
      beforeDir = path.resolve(values['before-dir']);
      const sha = await tryGit(beforeDir, ['rev-parse', '--short', 'HEAD']);
      beforeLabel =
        values['before-label'] ?? (sha ? `before (${sha})` : beforeDir);
    } else if (values.before) {
      const wt = await prepareWorktree(
        repoRoot,
        values.before,
        'before-worktree',
        tmpDir,
      );
      createdWorktrees.push(wt.dir);
      beforeDir = wt.dir;
      beforeLabel =
        values['before-label'] ?? `${values.before} (${wt.shortSha})`;
    } else {
      const afterRefForMergeBase = values.after ?? 'HEAD';
      const resolved = await resolveDefaultBeforeRef(
        repoRoot,
        afterRefForMergeBase,
      );
      const wt = await prepareWorktree(
        repoRoot,
        resolved.ref,
        'before-worktree',
        tmpDir,
      );
      createdWorktrees.push(wt.dir);
      beforeDir = wt.dir;
      beforeLabel = values['before-label'] ?? resolved.label;
    }

    const beforeHasBench = await fileExists(
      path.join(beforeDir, 'scripts', 'bench.ts'),
    );

    const compareOpts = {
      beforeLabel,
      afterLabel,
      warnThresholdPct,
      failThresholdPct,
    };

    const retryRuns: RetryRun[] = [];
    let summary: CompareSummary;
    if (!beforeHasBench) {
      console.log(
        `Before (${beforeLabel}) does not contain scripts/bench.ts; running bootstrap benchmark on after...`,
      );
      const afterReports = await runAfterOnlyRounds(
        afterDir,
        tmpDir,
        rounds,
        'bootstrap',
        benchOpts,
      );
      summary = compareReports([], afterReports, compareOpts);

      for (let attempt = 1; attempt <= retries; attempt++) {
        const scalingCaseIds = [
          ...new Set(
            summary.scalingChecks
              .filter(c => !c.passed)
              .flatMap(c => [c.smallId, c.largeId]),
          ),
        ];
        if (scalingCaseIds.length === 0) {
          break;
        }
        const retryFilter = scalingCaseIds.join(',');
        console.log(
          `\nConfirmation retry ${attempt}/${retries} for failing scaling guardrail case(s): ${retryFilter}`,
        );
        const retryAfter = await runAfterOnlyRounds(
          afterDir,
          tmpDir,
          rounds,
          `retry-${attempt}-scaling`,
          {
            ...benchOpts,
            filter: undefined,
            exactFilter: retryFilter,
          },
        );
        retryRuns.push({ before: [], after: retryAfter });
        summary = compareReports([], afterReports, {
          ...compareOpts,
          retries: retryRuns,
        });
      }
    } else {
      const initial = await runInterleavedRounds(
        beforeDir,
        afterDir,
        tmpDir,
        rounds,
        'initial',
        benchOpts,
      );
      summary = compareReports(
        initial.beforeReports,
        initial.afterReports,
        compareOpts,
      );

      for (let attempt = 1; attempt <= retries; attempt++) {
        const failingIds = summary.comparisons
          .filter(c => c.status === 'fail')
          .map(c => c.id);
        const failingIdSet = new Set(failingIds);

        if (failingIds.length > 0) {
          const retryFilter = failingIds.join(',');
          console.log(
            `\nConfirmation retry ${attempt}/${retries} for ${failingIds.length} case(s): ${retryFilter}`,
          );
          const retryRun = await runInterleavedRounds(
            beforeDir,
            afterDir,
            tmpDir,
            rounds,
            `retry-${attempt}`,
            {
              ...benchOpts,
              filter: undefined,
              exactFilter: retryFilter,
            },
          );
          retryRuns.push({
            before: retryRun.beforeReports,
            after: retryRun.afterReports,
          });
          summary = compareReports(
            initial.beforeReports,
            initial.afterReports,
            {
              ...compareOpts,
              retries: retryRuns,
            },
          );
        }

        const unretriedScalingCaseIds = [
          ...new Set(
            summary.scalingChecks
              .filter(
                c =>
                  !c.passed &&
                  !failingIdSet.has(c.smallId) &&
                  !failingIdSet.has(c.largeId),
              )
              .flatMap(c => [c.smallId, c.largeId]),
          ),
        ];

        if (unretriedScalingCaseIds.length > 0) {
          const scalingFilter = unretriedScalingCaseIds.join(',');
          console.log(
            `\nConfirmation retry ${attempt}/${retries} for failing scaling guardrail case(s): ${scalingFilter}`,
          );
          const retryAfter = await runAfterOnlyRounds(
            afterDir,
            tmpDir,
            rounds,
            `retry-${attempt}-scaling`,
            {
              ...benchOpts,
              filter: undefined,
              exactFilter: scalingFilter,
            },
          );
          retryRuns.push({ before: [], after: retryAfter });
          summary = compareReports(
            initial.beforeReports,
            initial.afterReports,
            {
              ...compareOpts,
              retries: retryRuns,
            },
          );
        }

        if (failingIds.length === 0 && unretriedScalingCaseIds.length === 0) {
          break;
        }
      }
    }

    console.log('\n' + renderText(summary));

    if (values['markdown-out']) {
      await writeFile(values['markdown-out'], renderMarkdown(summary), 'utf8');
    }
    if (values['json-out']) {
      await writeFile(
        values['json-out'],
        JSON.stringify(summary, null, 2) + '\n',
        'utf8',
      );
    }

    if (!summary.passed) {
      process.exitCode = 1;
    }
  } finally {
    process.off('SIGINT', onSigInt);
    process.off('SIGTERM', onSigTerm);
    await cleanup();
  }
}

await main();
