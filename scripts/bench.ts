import { glob, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { Bench } from 'tinybench';

import type {
  BenchCase,
  BenchSuite,
  ScalingExpectation,
} from '../lib/testing/bench.js';

export type { BenchCase, BenchSuite, ScalingExpectation };

export interface CaseResult {
  readonly id: string;
  readonly suite: string;
  readonly group: string;
  readonly description: string;
  readonly work?: Readonly<Record<string, number>>;
  readonly samples: number;
  readonly p50Ms: number;
  readonly p75Ms: number;
  readonly meanMs: number;
  readonly rmePercent: number;
  readonly throughputs?: Readonly<Record<string, number>>;
}

export interface ScalingCheckResult {
  readonly id: string;
  readonly suite: string;
  readonly label: string;
  readonly smallId: string;
  readonly largeId: string;
  readonly sizeRatio: number;
  readonly timeRatio: number;
  readonly normalizedRatio: number;
  readonly maxNormalizedRatio: number;
  readonly passed: boolean;
}

export interface BenchReport {
  readonly schemaVersion: 1;
  readonly timestamp: string;
  readonly nodeVersion: string;
  readonly platform: string;
  readonly cpuModel: string;
  readonly cases: readonly CaseResult[];
  readonly scalingChecks: readonly ScalingCheckResult[];
}

interface LoadedCase {
  readonly fullId: string;
  readonly suite: string;
  readonly def: BenchCase;
}

interface LoadedScalingCheck {
  readonly fullId: string;
  readonly suite: string;
  readonly label: string;
  readonly smallFullId: string;
  readonly largeFullId: string;
  readonly sizeUnit?: string;
  readonly explicitSizeRatio?: number;
  readonly maxNormalizedRatio: number;
}

interface BenchModule {
  readonly createSuite?: () => BenchSuite | Promise<BenchSuite>;
  readonly suite?: BenchSuite;
}

async function discoverBenchFiles(
  explicitFiles: readonly string[],
): Promise<string[]> {
  if (explicitFiles.length > 0) {
    return explicitFiles.map(f => path.resolve(f));
  }
  const discovered: string[] = [];
  for await (const entry of glob('**/*.bench.ts', {
    exclude: p => p === 'node_modules' || p === 'build' || p === '.git',
  })) {
    discovered.push(path.resolve(entry));
  }
  discovered.sort();
  return discovered;
}

async function loadSuites(
  files: readonly string[],
): Promise<readonly BenchSuite[]> {
  const suites: BenchSuite[] = [];
  for (const filePath of files) {
    const mod = (await import(pathToFileURL(filePath).href)) as BenchModule;
    if (typeof mod.createSuite === 'function') {
      suites.push(await mod.createSuite());
    } else if (mod.suite) {
      suites.push(mod.suite);
    } else {
      throw new Error(
        `Benchmark file ${filePath} must export createSuite() or suite`,
      );
    }
  }
  return suites;
}

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

function splitPatterns(filterArg: string): string[] {
  return filterArg
    .split(',')
    .map(p => p.trim())
    .filter(Boolean);
}

function matchesPattern(value: string, filterArg: string | undefined): boolean {
  if (!filterArg) {
    return true;
  }
  const patterns = splitPatterns(filterArg);
  return patterns.some(p => value === p || value.includes(p));
}

function matchesExact(value: string, filterArg: string | undefined): boolean {
  if (!filterArg) {
    return true;
  }
  const patterns = splitPatterns(filterArg);
  return patterns.includes(value);
}

function computeSizeRatio(
  checkId: string,
  small: CaseResult,
  large: CaseResult,
  sizeUnit: string | undefined,
  explicitSizeRatio: number | undefined,
): number {
  if (explicitSizeRatio !== undefined) {
    return explicitSizeRatio;
  }
  if (sizeUnit !== undefined) {
    const smallVal = small.work?.[sizeUnit];
    const largeVal = large.work?.[sizeUnit];
    if (
      smallVal === undefined ||
      largeVal === undefined ||
      !Number.isFinite(smallVal) ||
      !Number.isFinite(largeVal) ||
      smallVal <= 0 ||
      largeVal <= 0
    ) {
      throw new Error(
        `Scaling check "${checkId}" requested sizeUnit "${sizeUnit}", which is missing or non-positive on "${small.id}" / "${large.id}"`,
      );
    }
    return largeVal / smallVal;
  }
  if (small.work && large.work) {
    for (const [unit, smallVal] of Object.entries(small.work)) {
      const largeVal = large.work[unit];
      if (
        largeVal !== undefined &&
        Number.isFinite(smallVal) &&
        Number.isFinite(largeVal) &&
        smallVal > 0 &&
        largeVal > 0
      ) {
        return largeVal / smallVal;
      }
    }
  }
  return 1;
}

function evaluateScalingChecks(
  resultsById: ReadonlyMap<string, CaseResult>,
  checks: readonly LoadedScalingCheck[],
): ScalingCheckResult[] {
  const evaluated: ScalingCheckResult[] = [];
  for (const check of checks) {
    const small = resultsById.get(check.smallFullId);
    const large = resultsById.get(check.largeFullId);
    if (!small || !large) {
      continue;
    }
    const sizeRatio = computeSizeRatio(
      check.fullId,
      small,
      large,
      check.sizeUnit,
      check.explicitSizeRatio,
    );
    if (!Number.isFinite(sizeRatio) || sizeRatio <= 0) {
      throw new Error(
        `Scaling check "${check.fullId}" produced invalid size ratio: ${sizeRatio}`,
      );
    }
    if (!Number.isFinite(small.p50Ms) || small.p50Ms <= 0) {
      throw new Error(
        `Scaling check "${check.fullId}" has non-positive small p50Ms: ${small.p50Ms}`,
      );
    }
    const timeRatio = large.p50Ms / small.p50Ms;
    const normalizedRatio = timeRatio / sizeRatio;
    evaluated.push({
      id: check.fullId,
      suite: check.suite,
      label: check.label,
      smallId: check.smallFullId,
      largeId: check.largeFullId,
      sizeRatio,
      timeRatio,
      normalizedRatio,
      maxNormalizedRatio: check.maxNormalizedRatio,
      passed:
        Number.isFinite(normalizedRatio) &&
        normalizedRatio <= check.maxNormalizedRatio,
    });
  }
  return evaluated;
}

async function runCase(
  loaded: LoadedCase,
  options: {
    readonly timeMs: number;
    readonly iterations: number;
    readonly heavyIterations: number;
    readonly warmupTimeMs: number;
    readonly warmupIterations: number;
  },
): Promise<CaseResult> {
  const { def } = loaded;
  const bench = new Bench({
    time: def.heavy ? Math.max(options.timeMs, 500) : options.timeMs,
    iterations: def.heavy ? options.heavyIterations : options.iterations,
    warmupTime: def.heavy ? 0 : options.warmupTimeMs,
    warmupIterations: def.heavy ? 1 : options.warmupIterations,
    throws: true,
    timestampProvider: 'hrtimeNow',
  });

  bench.add(loaded.fullId, () => def.run());
  await bench.run();

  const task = bench.tasks[0];
  if (!task || task.result.state !== 'completed') {
    throw new Error(`Benchmark case "${loaded.fullId}" did not complete`);
  }

  const { latency } = task.result;
  const p50Ms = latency.p50;
  const p50Sec = p50Ms / 1000;

  let throughputs: Record<string, number> | undefined;
  if (def.work && p50Sec > 0) {
    const entries = Object.entries(def.work);
    if (entries.length > 0) {
      throughputs = {};
      for (const [unit, amount] of entries) {
        throughputs[unit] = amount / p50Sec;
      }
    }
  }

  return {
    id: loaded.fullId,
    suite: loaded.suite,
    group: def.group,
    description: def.description,
    work: def.work,
    samples: latency.samplesCount,
    p50Ms,
    p75Ms: latency.p75,
    meanMs: latency.mean,
    rmePercent: latency.rme,
    throughputs,
  };
}

function formatNumber(n: number, decimals = 2): string {
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatMetricValue(n: number): string {
  return Math.abs(n) >= 100
    ? Math.round(n).toLocaleString('en-US')
    : formatNumber(n, 2);
}

function formatWorkSummary(
  work: Readonly<Record<string, number>> | undefined,
): string {
  if (!work) {
    return '-';
  }
  const parts = Object.entries(work).map(([unit, amount]) => {
    const formatted = Number.isInteger(amount)
      ? amount.toLocaleString('en-US')
      : formatMetricValue(amount);
    return `${formatted} ${unit}`;
  });
  return parts.length > 0 ? parts.join(', ') : '-';
}

function printResults(
  results: readonly CaseResult[],
  scalingChecks: readonly ScalingCheckResult[],
): void {
  const grouped = new Map<string, CaseResult[]>();
  for (const r of results) {
    const key = `${r.suite} / ${r.group}`;
    const list = grouped.get(key) ?? [];
    list.push(r);
    grouped.set(key, list);
  }

  for (const [groupKey, rows] of grouped) {
    const units: string[] = [];
    const seenUnits = new Set<string>();
    for (const r of rows) {
      for (const unit of Object.keys(r.throughputs ?? {})) {
        if (!seenUnits.has(unit)) {
          seenUnits.add(unit);
          units.push(unit);
        }
      }
    }

    console.log(`\n=== ${groupKey} ===`);
    console.table(
      rows.map(r => {
        const row: Record<string, string | number> = {
          Case: r.id,
          'p50 (ms)': formatNumber(r.p50Ms, 2),
          'p75 (ms)': formatNumber(r.p75Ms, 2),
        };
        for (const unit of units) {
          const val = r.throughputs?.[unit];
          row[`${unit}/s`] = val !== undefined ? formatMetricValue(val) : '-';
        }
        row.Samples = r.samples;
        row['RME %'] = `±${formatNumber(r.rmePercent, 1)}%`;
        return row;
      }),
    );
  }

  if (scalingChecks.length > 0) {
    console.log('\n=== Scaling Guardrails ===');
    for (const check of scalingChecks) {
      const status = check.passed ? 'PASS' : 'FAIL';
      console.log(
        `  [${status}] [${check.suite}] ${check.label}: ${check.normalizedRatio.toFixed(2)}x normalized (time ${check.timeRatio.toFixed(2)}x for ${check.sizeRatio.toFixed(2)}x size, max ${check.maxNormalizedRatio.toFixed(2)}x)`,
      );
    }
  }
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      suite: { type: 'string' },
      filter: { type: 'string' },
      'exact-filter': { type: 'string' },
      json: { type: 'string' },
      time: { type: 'string', default: '800' },
      iterations: { type: 'string', default: '10' },
      'heavy-iterations': { type: 'string', default: '3' },
      'warmup-time': { type: 'string', default: '200' },
      'warmup-iterations': { type: 'string', default: '3' },
      quick: { type: 'boolean', default: false },
      'no-guardrails': { type: 'boolean', default: false },
      'allow-empty': { type: 'boolean', default: false },
      list: { type: 'boolean', default: false },
      quiet: { type: 'boolean', default: false },
    },
    strict: true,
  });

  const timeMs = values.quick
    ? 250
    : parseFiniteNumber(values.time, 'time', { min: 1 });
  const iterations = values.quick
    ? 5
    : parseFiniteNumber(values.iterations, 'iterations', {
        min: 1,
        integer: true,
      });
  const heavyIterations = values.quick
    ? 2
    : parseFiniteNumber(values['heavy-iterations'], 'heavy-iterations', {
        min: 1,
        integer: true,
      });
  const warmupTimeMs = values.quick
    ? 50
    : parseFiniteNumber(values['warmup-time'], 'warmup-time', { min: 0 });
  const warmupIterations = values.quick
    ? 1
    : parseFiniteNumber(values['warmup-iterations'], 'warmup-iterations', {
        min: 0,
        integer: true,
      });

  const files = await discoverBenchFiles(positionals);
  if (files.length === 0) {
    throw new Error('No *.bench.ts files found');
  }

  const allSuites = await loadSuites(files);
  const selectedSuites = allSuites.filter(s =>
    matchesPattern(s.name, values.suite),
  );

  const loadedCases: LoadedCase[] = [];
  const loadedScalingChecks: LoadedScalingCheck[] = [];
  const seenIds = new Set<string>();
  const seenScalingIds = new Set<string>();

  for (const suite of selectedSuites) {
    for (const def of suite.cases) {
      const fullId = `${suite.name}/${def.id}`;
      if (seenIds.has(fullId)) {
        throw new Error(`Duplicate benchmark case id "${fullId}"`);
      }
      seenIds.add(fullId);
      loadedCases.push({ fullId, suite: suite.name, def });
    }
    for (const check of suite.scalingChecks ?? []) {
      const fullId = `${suite.name}/${check.id}`;
      if (seenScalingIds.has(fullId)) {
        throw new Error(`Duplicate scaling check id "${fullId}"`);
      }
      seenScalingIds.add(fullId);
      loadedScalingChecks.push({
        fullId,
        suite: suite.name,
        label: check.label,
        smallFullId: `${suite.name}/${check.smallId}`,
        largeFullId: `${suite.name}/${check.largeId}`,
        sizeUnit: check.sizeUnit,
        explicitSizeRatio: check.sizeRatio,
        maxNormalizedRatio: check.maxNormalizedRatio,
      });
    }
  }

  for (const check of loadedScalingChecks) {
    if (!seenIds.has(check.smallFullId)) {
      throw new Error(
        `Scaling check "${check.fullId}" references unknown case "${check.smallFullId}"`,
      );
    }
    if (!seenIds.has(check.largeFullId)) {
      throw new Error(
        `Scaling check "${check.fullId}" references unknown case "${check.largeFullId}"`,
      );
    }
  }

  const selectedCases = loadedCases.filter(
    c =>
      matchesPattern(c.fullId, values.filter) &&
      matchesExact(c.fullId, values['exact-filter']),
  );

  if (values.list) {
    for (const c of selectedCases) {
      const workStr = formatWorkSummary(c.def.work).padStart(20);
      console.log(
        `${c.fullId.padEnd(32)} [${c.def.group.padEnd(8)}] ${workStr}  ${c.def.description}`,
      );
    }
    return;
  }

  if (selectedCases.length === 0 && !values['allow-empty']) {
    throw new Error(
      `No benchmark cases matched suite="${values.suite ?? '*'}" filter="${values.filter ?? '*'}" exact-filter="${values['exact-filter'] ?? '*'}"`,
    );
  }

  const cpuModel = os.cpus()[0]?.model ?? 'unknown';
  if (!values.quiet && values.json !== '-') {
    console.log(
      `Ledger Benchmarks (Node ${process.version}, ${os.platform()}/${os.arch()}, ${cpuModel})`,
    );
    console.log(
      `Running ${selectedCases.length} case(s) across ${selectedSuites.length} suite(s)...`,
    );
  }

  const results: CaseResult[] = [];
  for (const c of selectedCases) {
    results.push(
      await runCase(c, {
        timeMs,
        iterations,
        heavyIterations,
        warmupTimeMs,
        warmupIterations,
      }),
    );
  }

  const resultsById = new Map(results.map(r => [r.id, r]));
  const scalingChecks = evaluateScalingChecks(resultsById, loadedScalingChecks);

  const report: BenchReport = {
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    nodeVersion: process.version,
    platform: `${os.platform()}/${os.arch()}`,
    cpuModel,
    cases: results,
    scalingChecks,
  };

  if (values.json) {
    const serialized = JSON.stringify(report, null, 2) + '\n';
    if (values.json === '-') {
      process.stdout.write(serialized);
    } else {
      await writeFile(values.json, serialized, 'utf8');
    }
  }

  if (!values.quiet && values.json !== '-') {
    printResults(results, scalingChecks);
  }

  if (!values['no-guardrails']) {
    const failed = scalingChecks.filter(c => !c.passed);
    if (failed.length > 0) {
      console.error(`\n${failed.length} scaling guardrail check(s) failed.`);
      process.exitCode = 1;
    }
  }
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  await main();
}
