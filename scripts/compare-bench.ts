import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import type { BenchReport, ScalingCheckResult } from './bench.js';

export type ComparisonStatus =
  'pass' | 'faster' | 'warn' | 'fail' | 'new' | 'removed';

export interface CaseComparison {
  readonly id: string;
  readonly suite: string;
  readonly group: string;
  readonly beforeP50Ms: number | null;
  readonly afterP50Ms: number | null;
  readonly beforeThroughputs: Readonly<Record<string, number>> | null;
  readonly afterThroughputs: Readonly<Record<string, number>> | null;
  readonly deltaPct: number | null;
  readonly initialDeltaPct?: number;
  readonly retried: boolean;
  readonly sizeChanged: boolean;
  readonly status: ComparisonStatus;
}

export interface RetryRun {
  readonly before: readonly BenchReport[];
  readonly after: readonly BenchReport[];
}

export interface CompareOptions {
  readonly beforeLabel: string;
  readonly afterLabel: string;
  readonly warnThresholdPct: number;
  readonly failThresholdPct: number;
  readonly retryBefore?: readonly BenchReport[];
  readonly retryAfter?: readonly BenchReport[];
  readonly retries?: readonly RetryRun[];
}

export interface CompareSummary {
  readonly beforeLabel: string;
  readonly afterLabel: string;
  readonly bootstrapMode: boolean;
  readonly rounds: number;
  readonly warnThresholdPct: number;
  readonly failThresholdPct: number;
  readonly nodeVersion: string;
  readonly cpuModel: string;
  readonly comparisons: readonly CaseComparison[];
  readonly scalingChecks: readonly ScalingCheckResult[];
  readonly passed: boolean;
}

export function validateBenchReport(
  value: unknown,
  source: string,
): BenchReport {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`Invalid benchmark report in ${source}: expected object`);
  }
  const obj = value as Record<string, unknown>;
  if (obj.schemaVersion !== 1) {
    throw new Error(
      `Unsupported benchmark report schemaVersion in ${source}: ${String(obj.schemaVersion)} (expected 1)`,
    );
  }
  if (!Array.isArray(obj.cases) || !Array.isArray(obj.scalingChecks)) {
    throw new Error(
      `Invalid benchmark report in ${source}: missing cases or scalingChecks array`,
    );
  }
  return value as BenchReport;
}

function parseNonNegativeNumber(raw: string, flagName: string): number {
  if (raw.trim() === '') {
    throw new Error(`Invalid value for --${flagName}: "${raw}"`);
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(
      `--${flagName} must be a non-negative number, got "${raw}"`,
    );
  }
  return value;
}

function median(values: readonly number[]): number {
  if (values.length === 0) {
    throw new Error('Cannot compute median of empty array');
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function classifyDelta(
  deltaPct: number,
  warnThresholdPct: number,
  failThresholdPct: number,
): ComparisonStatus {
  if (!Number.isFinite(deltaPct)) {
    throw new Error(`Invalid non-finite benchmark delta: ${deltaPct}`);
  }
  if (deltaPct > failThresholdPct) {
    return 'fail';
  }
  if (deltaPct > warnThresholdPct) {
    return 'warn';
  }
  if (deltaPct < -warnThresholdPct) {
    return 'faster';
  }
  return 'pass';
}

function medianThroughputs(
  samples: readonly (Readonly<Record<string, number>> | undefined)[],
): Readonly<Record<string, number>> | null {
  const byUnit = new Map<string, number[]>();
  for (const sample of samples) {
    if (!sample) {
      continue;
    }
    for (const [unit, value] of Object.entries(sample)) {
      if (!Number.isFinite(value)) {
        continue;
      }
      const list = byUnit.get(unit) ?? [];
      list.push(value);
      byUnit.set(unit, list);
    }
  }
  if (byUnit.size === 0) {
    return null;
  }
  const out: Record<string, number> = {};
  for (const [unit, values] of byUnit) {
    out[unit] = median(values);
  }
  return out;
}

function summarizeSingleSide(
  id: string,
  reports: readonly BenchReport[],
): {
  readonly p50Ms: number;
  readonly throughputs: Readonly<Record<string, number>> | null;
} {
  const p50s = reports
    .map(r => r.cases.find(x => x.id === id)?.p50Ms)
    .filter((v): v is number => v !== undefined);
  const throughputSamples = reports.map(
    r => r.cases.find(x => x.id === id)?.throughputs,
  );
  return {
    p50Ms: median(p50s),
    throughputs: medianThroughputs(throughputSamples),
  };
}

function findSharedPositiveWork(
  beforeWork: Readonly<Record<string, number>> | undefined,
  afterWork: Readonly<Record<string, number>> | undefined,
): { readonly beforeVal: number; readonly afterVal: number } | undefined {
  if (!beforeWork || !afterWork) {
    return undefined;
  }
  for (const [unit, beforeVal] of Object.entries(beforeWork)) {
    const afterVal = afterWork[unit];
    if (
      afterVal !== undefined &&
      Number.isFinite(beforeVal) &&
      Number.isFinite(afterVal) &&
      beforeVal > 0 &&
      afterVal > 0
    ) {
      return { beforeVal, afterVal };
    }
  }
  return undefined;
}

function computePairedStats(
  id: string,
  beforeReports: readonly BenchReport[],
  afterReports: readonly BenchReport[],
): {
  readonly beforeP50Ms: number;
  readonly afterP50Ms: number;
  readonly beforeThroughputs: Readonly<Record<string, number>> | null;
  readonly afterThroughputs: Readonly<Record<string, number>> | null;
  readonly deltaPct: number;
  readonly sizeChanged: boolean;
} {
  const ratios: number[] = [];
  const beforeP50s: number[] = [];
  const afterP50s: number[] = [];
  const beforeThroughputSamples: (
    Readonly<Record<string, number>> | undefined
  )[] = [];
  const afterThroughputSamples: (
    Readonly<Record<string, number>> | undefined
  )[] = [];
  let sizeChanged = false;

  const pairCount = Math.min(beforeReports.length, afterReports.length);
  for (let i = 0; i < pairCount; i++) {
    const b = beforeReports[i].cases.find(c => c.id === id);
    const a = afterReports[i].cases.find(c => c.id === id);
    if (!b || !a) {
      continue;
    }
    if (!Number.isFinite(b.p50Ms) || b.p50Ms <= 0) {
      throw new Error(`Case "${id}" has non-positive before p50Ms: ${b.p50Ms}`);
    }
    if (!Number.isFinite(a.p50Ms) || a.p50Ms <= 0) {
      throw new Error(`Case "${id}" has non-positive after p50Ms: ${a.p50Ms}`);
    }
    beforeP50s.push(b.p50Ms);
    afterP50s.push(a.p50Ms);
    beforeThroughputSamples.push(b.throughputs);
    afterThroughputSamples.push(a.throughputs);

    const sharedWork = findSharedPositiveWork(b.work, a.work);
    if (sharedWork && sharedWork.beforeVal !== sharedWork.afterVal) {
      sizeChanged = true;
      ratios.push(
        a.p50Ms / sharedWork.afterVal / (b.p50Ms / sharedWork.beforeVal),
      );
    } else {
      ratios.push(a.p50Ms / b.p50Ms);
    }
  }

  const medianRatio = median(ratios);
  return {
    beforeP50Ms: median(beforeP50s),
    afterP50Ms: median(afterP50s),
    beforeThroughputs: medianThroughputs(beforeThroughputSamples),
    afterThroughputs: medianThroughputs(afterThroughputSamples),
    deltaPct: (medianRatio - 1) * 100,
    sizeChanged,
  };
}

function aggregateAfterScalingChecks(
  afterReports: readonly BenchReport[],
  retryRuns: readonly RetryRun[],
): ScalingCheckResult[] {
  const templateChecks = afterReports[0]?.scalingChecks ?? [];
  if (templateChecks.length === 0) {
    return [];
  }

  const latestSourceById = new Map<string, readonly BenchReport[]>();
  for (const c of afterReports[0].cases) {
    latestSourceById.set(c.id, afterReports);
  }
  for (const retry of retryRuns) {
    for (const c of retry.after[0].cases) {
      latestSourceById.set(c.id, retry.after);
    }
  }

  return templateChecks.map(check => {
    const smallSource = latestSourceById.get(check.smallId);
    const largeSource = latestSourceById.get(check.largeId);
    if (!smallSource || !largeSource) {
      return check;
    }
    if (!Number.isFinite(check.sizeRatio) || check.sizeRatio <= 0) {
      throw new Error(
        `Scaling check "${check.id}" has invalid sizeRatio: ${check.sizeRatio}`,
      );
    }

    let timeRatio: number;
    if (smallSource === largeSource) {
      const roundRatios: number[] = [];
      for (const report of smallSource) {
        const small = report.cases.find(c => c.id === check.smallId);
        const large = report.cases.find(c => c.id === check.largeId);
        if (!small || !large) {
          continue;
        }
        if (!Number.isFinite(small.p50Ms) || small.p50Ms <= 0) {
          throw new Error(
            `Scaling check "${check.id}" has non-positive small p50Ms: ${small.p50Ms}`,
          );
        }
        roundRatios.push(large.p50Ms / small.p50Ms);
      }
      if (roundRatios.length === 0) {
        return check;
      }
      timeRatio = median(roundRatios);
    } else {
      const smallP50s = smallSource
        .map(r => r.cases.find(c => c.id === check.smallId)?.p50Ms)
        .filter((v): v is number => v !== undefined);
      const largeP50s = largeSource
        .map(r => r.cases.find(c => c.id === check.largeId)?.p50Ms)
        .filter((v): v is number => v !== undefined);
      if (smallP50s.length === 0 || largeP50s.length === 0) {
        return check;
      }
      const smallMedian = median(smallP50s);
      if (!Number.isFinite(smallMedian) || smallMedian <= 0) {
        throw new Error(
          `Scaling check "${check.id}" has non-positive small p50Ms: ${smallMedian}`,
        );
      }
      timeRatio = median(largeP50s) / smallMedian;
    }

    const normalizedRatio = timeRatio / check.sizeRatio;
    return {
      ...check,
      timeRatio,
      normalizedRatio,
      passed:
        Number.isFinite(normalizedRatio) &&
        normalizedRatio <= check.maxNormalizedRatio,
    };
  });
}

function collectRetryRuns(options: CompareOptions): RetryRun[] {
  const runs: RetryRun[] = [];
  const legacyBefore = options.retryBefore ?? [];
  const legacyAfter = options.retryAfter ?? [];
  if (legacyBefore.length > 0 || legacyAfter.length > 0) {
    runs.push({ before: legacyBefore, after: legacyAfter });
  }
  for (const run of options.retries ?? []) {
    if (run.before.length > 0 || run.after.length > 0) {
      runs.push(run);
    }
  }
  for (const run of runs) {
    if (run.after.length === 0) {
      throw new Error('Retry run must include at least one "after" report');
    }
    if (run.before.length > 0 && run.before.length !== run.after.length) {
      throw new Error(
        `Retry run has mismatched report counts: ${run.before.length} before vs ${run.after.length} after`,
      );
    }
  }
  return runs;
}

export function compareReports(
  beforeReports: readonly BenchReport[],
  afterReports: readonly BenchReport[],
  options: CompareOptions,
): CompareSummary {
  if (afterReports.length === 0) {
    throw new Error('At least one "after" benchmark report is required');
  }
  if (
    !Number.isFinite(options.warnThresholdPct) ||
    options.warnThresholdPct < 0
  ) {
    throw new Error(
      `Invalid warnThresholdPct: ${options.warnThresholdPct} (must be >= 0)`,
    );
  }
  if (
    !Number.isFinite(options.failThresholdPct) ||
    options.failThresholdPct < options.warnThresholdPct
  ) {
    throw new Error(
      `Invalid failThresholdPct: ${options.failThresholdPct} (must be >= warnThresholdPct ${options.warnThresholdPct})`,
    );
  }

  const bootstrapMode = beforeReports.length === 0;
  if (!bootstrapMode && beforeReports.length !== afterReports.length) {
    throw new Error(
      `Mismatched report counts: ${beforeReports.length} before vs ${afterReports.length} after`,
    );
  }

  const retryRuns = collectRetryRuns(options);
  const comparisons: CaseComparison[] = [];

  if (bootstrapMode) {
    const afterTemplate = afterReports[0];
    for (const c of afterTemplate.cases) {
      const stats = summarizeSingleSide(c.id, afterReports);
      comparisons.push({
        id: c.id,
        suite: c.suite,
        group: c.group,
        beforeP50Ms: null,
        afterP50Ms: stats.p50Ms,
        beforeThroughputs: null,
        afterThroughputs: stats.throughputs,
        deltaPct: null,
        retried: false,
        sizeChanged: false,
        status: 'new',
      });
    }
  } else {
    const beforeTemplate = beforeReports[0];
    const afterTemplate = afterReports[0];
    const beforeIds = new Set(beforeTemplate.cases.map(c => c.id));
    const afterIds = new Set(afterTemplate.cases.map(c => c.id));

    for (const c of afterTemplate.cases) {
      if (!beforeIds.has(c.id)) {
        const stats = summarizeSingleSide(c.id, afterReports);
        comparisons.push({
          id: c.id,
          suite: c.suite,
          group: c.group,
          beforeP50Ms: null,
          afterP50Ms: stats.p50Ms,
          beforeThroughputs: null,
          afterThroughputs: stats.throughputs,
          deltaPct: null,
          retried: false,
          sizeChanged: false,
          status: 'new',
        });
        continue;
      }

      const stats = computePairedStats(c.id, beforeReports, afterReports);
      comparisons.push({
        id: c.id,
        suite: c.suite,
        group: c.group,
        ...stats,
        retried: false,
        status: classifyDelta(
          stats.deltaPct,
          options.warnThresholdPct,
          options.failThresholdPct,
        ),
      });
    }

    for (const c of beforeTemplate.cases) {
      if (!afterIds.has(c.id)) {
        const stats = summarizeSingleSide(c.id, beforeReports);
        comparisons.push({
          id: c.id,
          suite: c.suite,
          group: c.group,
          beforeP50Ms: stats.p50Ms,
          afterP50Ms: null,
          beforeThroughputs: stats.throughputs,
          afterThroughputs: null,
          deltaPct: null,
          retried: false,
          sizeChanged: false,
          status: 'removed',
        });
      }
    }

    // Merge optional confirmation retry results in chronological order.
    for (const retry of retryRuns) {
      if (retry.before.length === 0) {
        continue;
      }
      const retryBeforeIds = new Set(retry.before[0].cases.map(c => c.id));
      const retryAfterIds = new Set(retry.after[0].cases.map(c => c.id));
      for (let i = 0; i < comparisons.length; i++) {
        const current = comparisons[i];
        if (
          current.status === 'new' ||
          current.status === 'removed' ||
          !retryBeforeIds.has(current.id) ||
          !retryAfterIds.has(current.id)
        ) {
          continue;
        }
        const retryStats = computePairedStats(
          current.id,
          retry.before,
          retry.after,
        );
        comparisons[i] = {
          ...current,
          ...retryStats,
          initialDeltaPct:
            current.initialDeltaPct ?? current.deltaPct ?? undefined,
          retried: true,
          status: classifyDelta(
            retryStats.deltaPct,
            options.warnThresholdPct,
            options.failThresholdPct,
          ),
        };
      }
    }
  }

  const scalingChecks = aggregateAfterScalingChecks(afterReports, retryRuns);
  const hasRegressionFailure = comparisons.some(c => c.status === 'fail');
  const hasScalingFailure = scalingChecks.some(c => !c.passed);

  const meta = afterReports[0];
  return {
    beforeLabel: options.beforeLabel,
    afterLabel: options.afterLabel,
    bootstrapMode,
    rounds: afterReports.length,
    warnThresholdPct: options.warnThresholdPct,
    failThresholdPct: options.failThresholdPct,
    nodeVersion: meta.nodeVersion,
    cpuModel: meta.cpuModel,
    comparisons,
    scalingChecks,
    passed: !hasRegressionFailure && !hasScalingFailure,
  };
}

function formatMs(ms: number | null): string {
  return ms === null ? '—' : `${ms.toFixed(2)} ms`;
}

function formatPct(pct: number): string {
  const normalized = Math.abs(pct) < 0.05 ? 0 : pct;
  const sign = normalized >= 0 ? '+' : '';
  return `${sign}${normalized.toFixed(1)}%`;
}

function formatDelta(c: CaseComparison): string {
  if (c.deltaPct === null) {
    return '—';
  }
  const base = formatPct(c.deltaPct);
  const notes: string[] = [];
  if (c.retried && c.initialDeltaPct !== undefined) {
    notes.push(`initial ${formatPct(c.initialDeltaPct)}`);
  }
  if (c.sizeChanged) {
    notes.push('size-normalized');
  }
  return notes.length > 0 ? `${base} (${notes.join(', ')})` : base;
}

function statusBadge(status: ComparisonStatus, retried: boolean): string {
  switch (status) {
    case 'pass':
      return retried ? 'PASS (retry)' : 'PASS';
    case 'faster':
      return retried ? 'FASTER (retry)' : 'FASTER';
    case 'warn':
      return retried ? 'WARN (retry)' : 'WARN';
    case 'fail':
      return retried ? 'FAIL (retry)' : 'FAIL';
    case 'new':
      return 'NEW';
    case 'removed':
      return 'REMOVED';
  }
}

type ColumnAlign = 'left' | 'right';

function formatAlignedTable(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
  alignments: readonly ColumnAlign[],
): string[] {
  const widths = headers.map((h, i) =>
    rows.reduce((max, row) => Math.max(max, (row[i] ?? '').length), h.length),
  );

  const formatRow = (cells: readonly string[]) =>
    cells
      .map((cell, i) =>
        alignments[i] === 'right'
          ? cell.padStart(widths[i])
          : cell.padEnd(widths[i]),
      )
      .join('  ')
      .trimEnd();

  const divider = widths.map(w => '-'.repeat(w)).join('  ');
  return [formatRow(headers), divider, ...rows.map(formatRow)];
}

function formatThroughput(value: number | undefined, empty: string): string {
  if (value === undefined) {
    return empty;
  }
  return Math.abs(value) >= 100
    ? Math.round(value).toLocaleString('en-US')
    : value.toFixed(2);
}

function groupComparisonsBySuite(
  comparisons: readonly CaseComparison[],
): Map<string, CaseComparison[]> {
  const grouped = new Map<string, CaseComparison[]>();
  for (const c of comparisons) {
    const list = grouped.get(c.suite) ?? [];
    list.push(c);
    grouped.set(c.suite, list);
  }
  return grouped;
}

function collectSuiteUnits(rows: readonly CaseComparison[]): string[] {
  const units: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const source of [row.afterThroughputs, row.beforeThroughputs]) {
      if (!source) {
        continue;
      }
      for (const unit of Object.keys(source)) {
        if (!seen.has(unit)) {
          seen.add(unit);
          units.push(unit);
        }
      }
    }
  }
  return units;
}

function getVerdict(summary: CompareSummary): string {
  const hasWarnings = summary.comparisons.some(c => c.status === 'warn');
  return !summary.passed
    ? 'FAIL'
    : hasWarnings
      ? 'PASS (with warnings)'
      : 'PASS';
}

export function renderText(summary: CompareSummary): string {
  const lines: string[] = [];
  const verdict = getVerdict(summary);

  lines.push(`=== Benchmark Report — ${verdict} ===`);
  lines.push(`Before:      ${summary.beforeLabel}`);
  lines.push(`After:       ${summary.afterLabel}`);
  lines.push(
    `Config:      ${summary.rounds} round(s) | Warn > +${summary.warnThresholdPct}% | Fail > +${summary.failThresholdPct}%`,
  );
  lines.push(`Environment: Node ${summary.nodeVersion} | ${summary.cpuModel}`);

  if (summary.bootstrapMode) {
    lines.push('');
    lines.push(
      'Note: Baseline has no benchmark runner yet (bootstrap run — showing current measurements and scaling guardrails only).',
    );
  }

  for (const [suite, rows] of groupComparisonsBySuite(summary.comparisons)) {
    const units = collectSuiteUnits(rows);
    lines.push('');
    lines.push(`[${suite}]`);
    const headers = [
      'Case',
      'Group',
      'Before p50',
      'After p50',
      ...units.map(u => `${u}/s`),
      'Delta',
      'Status',
    ];
    const alignments: ColumnAlign[] = [
      'left',
      'left',
      'right',
      'right',
      ...units.map((): ColumnAlign => 'right'),
      'right',
      'left',
    ];
    const tableRows = rows.map(c => [
      c.id,
      c.group,
      formatMs(c.beforeP50Ms),
      formatMs(c.afterP50Ms),
      ...units.map(u => formatThroughput(c.afterThroughputs?.[u], '-')),
      formatDelta(c),
      statusBadge(c.status, c.retried),
    ]);
    lines.push(...formatAlignedTable(headers, tableRows, alignments));
  }

  if (summary.scalingChecks.length > 0) {
    lines.push('');
    lines.push('Scaling Guardrails');
    const scalingRows = summary.scalingChecks.map(check => [
      `${check.suite}: ${check.label}`,
      `${check.sizeRatio.toFixed(2)}x`,
      `${check.timeRatio.toFixed(2)}x`,
      `${check.normalizedRatio.toFixed(2)}x`,
      `<= ${check.maxNormalizedRatio.toFixed(2)}x`,
      check.passed ? 'PASS' : 'FAIL',
    ]);
    lines.push(
      ...formatAlignedTable(
        ['Check', 'Size Ratio', 'Time Ratio', 'Normalized', 'Limit', 'Status'],
        scalingRows,
        ['left', 'right', 'right', 'right', 'right', 'left'],
      ),
    );
  }

  lines.push('');
  return lines.join('\n');
}

export function renderMarkdown(summary: CompareSummary): string {
  const lines: string[] = [];
  const verdict = getVerdict(summary);

  lines.push(`## Benchmark Report — ${verdict}`);
  lines.push('');
  lines.push(
    `- **Before:** \`${summary.beforeLabel}\` | **After:** \`${summary.afterLabel}\``,
  );
  lines.push(
    `- **Config:** ${summary.rounds} round(s) | Warn > +${summary.warnThresholdPct}% | Fail > +${summary.failThresholdPct}%`,
  );
  lines.push(
    `- **Environment:** Node ${summary.nodeVersion} | ${summary.cpuModel}`,
  );
  lines.push('');

  if (summary.bootstrapMode) {
    lines.push(
      '> **Bootstrap run:** Baseline has no benchmark runner yet. Showing current measurements and scaling guardrails only.',
    );
    lines.push('');
  }

  lines.push('### Benchmark Results');
  lines.push('');
  for (const [suite, rows] of groupComparisonsBySuite(summary.comparisons)) {
    const units = collectSuiteUnits(rows);
    lines.push(`#### \`${suite}\``);
    lines.push('');
    const headers = [
      'Case',
      'Group',
      'Before p50',
      'After p50',
      ...units.map(u => `${u}/s`),
      'Delta',
      'Status',
    ];
    const alignRow = [
      ':---',
      ':---',
      '---:',
      '---:',
      ...units.map(() => '---:'),
      '---:',
      ':---',
    ];
    lines.push(`| ${headers.join(' | ')} |`);
    lines.push(`| ${alignRow.join(' | ')} |`);
    for (const c of rows) {
      const cells = [
        `\`${c.id}\``,
        c.group,
        formatMs(c.beforeP50Ms),
        formatMs(c.afterP50Ms),
        ...units.map(u => formatThroughput(c.afterThroughputs?.[u], '—')),
        formatDelta(c),
        statusBadge(c.status, c.retried),
      ];
      lines.push(`| ${cells.join(' | ')} |`);
    }
    lines.push('');
  }

  if (summary.scalingChecks.length > 0) {
    lines.push('### Scaling Guardrails');
    lines.push('');
    lines.push(
      '| Check | Size Ratio | Time Ratio | Normalized | Limit | Status |',
    );
    lines.push('| :--- | ---: | ---: | ---: | ---: | :--- |');
    for (const check of summary.scalingChecks) {
      lines.push(
        `| \`${check.suite}\`: ${check.label} | ${check.sizeRatio.toFixed(2)}x | ${check.timeRatio.toFixed(2)}x | ${check.normalizedRatio.toFixed(2)}x | <= ${check.maxNormalizedRatio.toFixed(2)}x | ${check.passed ? 'PASS' : 'FAIL'} |`,
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}

async function loadReports(paths: readonly string[]): Promise<BenchReport[]> {
  const reports: BenchReport[] = [];
  for (const p of paths) {
    const raw = await readFile(p, 'utf8');
    reports.push(validateBenchReport(JSON.parse(raw) as unknown, p));
  }
  return reports;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      before: { type: 'string', multiple: true, default: [] },
      after: { type: 'string', multiple: true, default: [] },
      'retry-before': { type: 'string', multiple: true, default: [] },
      'retry-after': { type: 'string', multiple: true, default: [] },
      'before-label': { type: 'string', default: 'before' },
      'after-label': { type: 'string', default: 'after' },
      'warn-threshold': { type: 'string', default: '5' },
      'fail-threshold': { type: 'string', default: '10' },
      'markdown-out': { type: 'string' },
      'json-out': { type: 'string' },
    },
    strict: true,
  });

  const warnThresholdPct = parseNonNegativeNumber(
    values['warn-threshold'],
    'warn-threshold',
  );
  const failThresholdPct = parseNonNegativeNumber(
    values['fail-threshold'],
    'fail-threshold',
  );

  const beforeReports = await loadReports(values.before);
  const afterReports = await loadReports(values.after);
  const retryBefore = await loadReports(values['retry-before']);
  const retryAfter = await loadReports(values['retry-after']);

  const summary = compareReports(beforeReports, afterReports, {
    beforeLabel: values['before-label'],
    afterLabel: values['after-label'],
    warnThresholdPct,
    failThresholdPct,
    retryBefore,
    retryAfter,
  });

  console.log(renderText(summary));

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
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  await main();
}
