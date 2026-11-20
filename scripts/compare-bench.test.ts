import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import type { BenchReport, CaseResult, ScalingCheckResult } from './bench.js';
import {
  compareReports,
  renderMarkdown,
  renderText,
  validateBenchReport,
} from './compare-bench.js';

function makeCase(
  id: string,
  p50Ms: number,
  options?: {
    readonly work?: Readonly<Record<string, number>>;
    readonly group?: string;
  },
): CaseResult {
  const work = options?.work ?? { MB: 1 };
  const throughputs: Record<string, number> = {};
  if (p50Ms > 0) {
    for (const [unit, amount] of Object.entries(work)) {
      throughputs[unit] = amount / (p50Ms / 1000);
    }
  }
  return {
    id,
    suite: id.split('/')[0] ?? 'parsing',
    group: options?.group ?? 'mixed',
    description: id,
    work,
    samples: 10,
    p50Ms,
    p75Ms: p50Ms * 1.02,
    meanMs: p50Ms,
    rmePercent: 1.0,
    throughputs,
  };
}

function makeReport(
  cases: readonly CaseResult[],
  scalingChecks: readonly ScalingCheckResult[] = [],
): BenchReport {
  return {
    schemaVersion: 1,
    timestamp: '2026-11-19T00:00:00.000Z',
    nodeVersion: 'v22.0.0',
    platform: 'linux/x64',
    cpuModel: 'Test CPU',
    cases,
    scalingChecks,
  };
}

describe('compareReports', () => {
  const baseOpts = {
    beforeLabel: 'main',
    afterLabel: 'pr',
    warnThresholdPct: 5,
    failThresholdPct: 10,
  };

  test('classifies pass, faster, warn, and fail deltas using paired medians', () => {
    const before = [
      makeReport([
        makeCase('parsing/pass', 100),
        makeCase('parsing/faster', 100),
        makeCase('parsing/warn', 100),
        makeCase('parsing/fail', 100),
      ]),
      makeReport([
        makeCase('parsing/pass', 102),
        makeCase('parsing/faster', 100),
        makeCase('parsing/warn', 100),
        makeCase('parsing/fail', 100),
      ]),
      makeReport([
        makeCase('parsing/pass', 98),
        makeCase('parsing/faster', 100),
        makeCase('parsing/warn', 100),
        makeCase('parsing/fail', 100),
      ]),
    ];
    const after = [
      makeReport([
        makeCase('parsing/pass', 103),
        makeCase('parsing/faster', 90),
        makeCase('parsing/warn', 107),
        makeCase('parsing/fail', 115),
      ]),
      makeReport([
        makeCase('parsing/pass', 104),
        makeCase('parsing/faster', 92),
        makeCase('parsing/warn', 108),
        makeCase('parsing/fail', 112),
      ]),
      makeReport([
        makeCase('parsing/pass', 100),
        makeCase('parsing/faster', 91),
        makeCase('parsing/warn', 106),
        makeCase('parsing/fail', 114),
      ]),
    ];

    const summary = compareReports(before, after, baseOpts);
    assert.equal(summary.passed, false);

    const byId = new Map(summary.comparisons.map(c => [c.id, c]));
    assert.equal(byId.get('parsing/pass')?.status, 'pass');
    assert.equal(byId.get('parsing/faster')?.status, 'faster');
    assert.equal(byId.get('parsing/warn')?.status, 'warn');
    assert.equal(byId.get('parsing/fail')?.status, 'fail');
  });

  test('merges confirmation retry and clears transient spike', () => {
    const before = [makeReport([makeCase('parsing/a', 100)])];
    const after = [makeReport([makeCase('parsing/a', 120)])];
    const retryBefore = [makeReport([makeCase('parsing/a', 100)])];
    const retryAfter = [makeReport([makeCase('parsing/a', 102)])];

    const summary = compareReports(before, after, {
      ...baseOpts,
      retryBefore,
      retryAfter,
    });

    assert.equal(summary.passed, true);
    const c = summary.comparisons[0];
    assert.equal(c.status, 'pass');
    assert.equal(c.retried, true);
    assert.equal(Math.round(c.initialDeltaPct ?? 0), 20);
    assert.equal(Math.round(c.deltaPct ?? 0), 2);
  });

  test('normalizes delta by work size when work changes', () => {
    const before = [
      makeReport([makeCase('parsing/a', 100, { work: { dirs: 1000 } })]),
    ];
    const after = [
      makeReport([makeCase('parsing/a', 200, { work: { dirs: 2000 } })]),
    ];

    const summary = compareReports(before, after, baseOpts);
    assert.equal(summary.passed, true);
    assert.equal(summary.comparisons[0].sizeChanged, true);
    assert.equal(summary.comparisons[0].status, 'pass');
    assert.ok(Math.abs(summary.comparisons[0].deltaPct ?? 99) < 0.001);
  });

  test('supports bootstrap mode when before reports are empty', () => {
    const after = [makeReport([makeCase('parsing/a', 50)])];

    const summary = compareReports([], after, baseOpts);
    assert.equal(summary.bootstrapMode, true);
    assert.equal(summary.passed, true);
    assert.equal(summary.comparisons[0].status, 'new');
    assert.equal(summary.comparisons[0].beforeP50Ms, null);
    assert.equal(summary.comparisons[0].afterP50Ms, 50);

    const md = renderMarkdown(summary);
    assert.match(md, /Bootstrap run/);
    assert.match(md, /\| `parsing\/a` \|/);
  });

  test('tracks added and removed cases across versions', () => {
    const before = [
      makeReport([
        makeCase('parsing/common', 100),
        makeCase('parsing/old', 50),
      ]),
    ];
    const after = [
      makeReport([
        makeCase('parsing/common', 100),
        makeCase('booking/new-case', 80),
      ]),
    ];

    const summary = compareReports(before, after, baseOpts);
    assert.equal(summary.passed, true);
    const byId = new Map(summary.comparisons.map(c => [c.id, c]));
    assert.equal(byId.get('parsing/common')?.status, 'pass');
    assert.equal(byId.get('booking/new-case')?.status, 'new');
    assert.equal(byId.get('parsing/old')?.status, 'removed');
  });

  test('fails overall verdict when an aggregated scaling guardrail fails', () => {
    const check: ScalingCheckResult = {
      id: 'parsing/size',
      suite: 'parsing',
      label: 'Size scaling',
      smallId: 'parsing/small',
      largeId: 'parsing/large',
      sizeRatio: 10,
      timeRatio: 30,
      normalizedRatio: 3,
      maxNormalizedRatio: 2,
      passed: false,
    };
    const before = [
      makeReport([
        makeCase('parsing/small', 10),
        makeCase('parsing/large', 300),
      ]),
    ];
    const after = [
      makeReport(
        [makeCase('parsing/small', 10), makeCase('parsing/large', 300)],
        [check],
      ),
    ];

    const summary = compareReports(before, after, baseOpts);
    assert.equal(summary.passed, false);
    assert.equal(summary.scalingChecks[0].passed, false);
  });

  test('preserves passing cases across multiple retry attempts', () => {
    const before = [
      makeReport([makeCase('parsing/a', 100), makeCase('parsing/b', 100)]),
    ];
    const after = [
      makeReport([makeCase('parsing/a', 120), makeCase('parsing/b', 125)]),
    ];

    // Attempt 1 retries both: a passes, b still fails.
    const retry1Before = [
      makeReport([makeCase('parsing/a', 100), makeCase('parsing/b', 100)]),
    ];
    const retry1After = [
      makeReport([makeCase('parsing/a', 101), makeCase('parsing/b', 115)]),
    ];

    // Attempt 2 retries only b: b passes.
    const retry2Before = [makeReport([makeCase('parsing/b', 100)])];
    const retry2After = [makeReport([makeCase('parsing/b', 102)])];

    const summary = compareReports(before, after, {
      ...baseOpts,
      retries: [
        { before: retry1Before, after: retry1After },
        { before: retry2Before, after: retry2After },
      ],
    });

    assert.equal(summary.passed, true);
    const byId = new Map(summary.comparisons.map(c => [c.id, c]));
    const a = byId.get('parsing/a');
    const b = byId.get('parsing/b');
    assert.equal(a?.status, 'pass');
    assert.equal(a?.retried, true);
    assert.equal(Math.round(a?.initialDeltaPct ?? 0), 20);
    assert.equal(Math.round(a?.deltaPct ?? 0), 1);
    assert.equal(b?.status, 'pass');
    assert.equal(b?.retried, true);
    assert.equal(Math.round(b?.initialDeltaPct ?? 0), 25);
    assert.equal(Math.round(b?.deltaPct ?? 0), 2);
  });

  test('ignores cases in retryAfter that are absent from retryBefore', () => {
    const before = [makeReport([makeCase('parsing/a', 100)])];
    const after = [
      makeReport([makeCase('parsing/a', 120), makeCase('parsing/a-new', 50)]),
    ];
    const retryBefore = [makeReport([makeCase('parsing/a', 100)])];
    const retryAfter = [
      makeReport([makeCase('parsing/a', 101), makeCase('parsing/a-new', 52)]),
    ];

    const summary = compareReports(before, after, {
      ...baseOpts,
      retryBefore,
      retryAfter,
    });

    assert.equal(summary.passed, true);
    const byId = new Map(summary.comparisons.map(c => [c.id, c]));
    assert.equal(byId.get('parsing/a')?.status, 'pass');
    assert.equal(byId.get('parsing/a-new')?.status, 'new');
    assert.equal(byId.get('parsing/a-new')?.retried, false);
  });

  test('updates scaling guardrails from confirmation retries', () => {
    const check: ScalingCheckResult = {
      id: 'parsing/size',
      suite: 'parsing',
      label: 'Size scaling',
      smallId: 'parsing/small',
      largeId: 'parsing/large',
      sizeRatio: 10,
      timeRatio: 30,
      normalizedRatio: 3,
      maxNormalizedRatio: 2,
      passed: false,
    };
    const before = [
      makeReport([
        makeCase('parsing/small', 10),
        makeCase('parsing/large', 150),
      ]),
    ];
    // Initial run: large spiked to 300ms (fails both A/B and scaling).
    const after = [
      makeReport(
        [makeCase('parsing/small', 10), makeCase('parsing/large', 300)],
        [check],
      ),
    ];
    // Interleaved retry of large clears both A/B and scaling.
    const retryBefore = [makeReport([makeCase('parsing/large', 150)])];
    const retryAfter = [makeReport([makeCase('parsing/large', 150)])];

    const summary = compareReports(before, after, {
      ...baseOpts,
      retries: [{ before: retryBefore, after: retryAfter }],
    });

    assert.equal(summary.passed, true);
    assert.equal(summary.scalingChecks[0].passed, true);
    assert.ok(Math.abs(summary.scalingChecks[0].normalizedRatio - 1.5) < 0.001);
  });

  test('supports after-only retry for scaling checks without altering A/B rows', () => {
    const check: ScalingCheckResult = {
      id: 'parsing/size',
      suite: 'parsing',
      label: 'Size scaling',
      smallId: 'parsing/small',
      largeId: 'parsing/large',
      sizeRatio: 10,
      timeRatio: 25,
      normalizedRatio: 2.5,
      maxNormalizedRatio: 2,
      passed: false,
    };
    const before = [
      makeReport([
        makeCase('parsing/small', 10),
        makeCase('parsing/large', 240),
      ]),
    ];
    const after = [
      makeReport(
        [makeCase('parsing/small', 10), makeCase('parsing/large', 250)],
        [check],
      ),
    ];
    const scalingRetryAfter = [
      makeReport([
        makeCase('parsing/small', 10),
        makeCase('parsing/large', 180),
      ]),
    ];

    const summary = compareReports(before, after, {
      ...baseOpts,
      retries: [{ before: [], after: scalingRetryAfter }],
    });

    assert.equal(summary.passed, true);
    assert.equal(summary.scalingChecks[0].passed, true);
    assert.ok(Math.abs(summary.scalingChecks[0].normalizedRatio - 1.8) < 0.001);
    const large = summary.comparisons.find(c => c.id === 'parsing/large');
    assert.equal(large?.retried, false);
    assert.equal(large?.afterP50Ms, 250);
  });

  test('computes scaling timeRatio from per-round paired ratios', () => {
    const check: ScalingCheckResult = {
      id: 'parsing/size',
      suite: 'parsing',
      label: 'Size scaling',
      smallId: 'parsing/small',
      largeId: 'parsing/large',
      sizeRatio: 10,
      timeRatio: 15,
      normalizedRatio: 1.5,
      maxNormalizedRatio: 2,
      passed: true,
    };
    // Round 1 is slow (2x load), rounds 2 & 3 are normal, ratio is always 15x.
    const after = [
      makeReport(
        [makeCase('parsing/small', 20), makeCase('parsing/large', 300)],
        [check],
      ),
      makeReport(
        [makeCase('parsing/small', 10), makeCase('parsing/large', 150)],
        [check],
      ),
      makeReport(
        [makeCase('parsing/small', 12), makeCase('parsing/large', 180)],
        [check],
      ),
    ];

    const summary = compareReports([], after, baseOpts);
    assert.equal(summary.passed, true);
    assert.ok(Math.abs(summary.scalingChecks[0].timeRatio - 15) < 0.001);
    assert.ok(Math.abs(summary.scalingChecks[0].normalizedRatio - 1.5) < 0.001);
  });

  test('does not divide by zero when work amount is 0', () => {
    const before = [
      makeReport([makeCase('parsing/empty', 10, { work: { MB: 0 } })]),
    ];
    const after = [
      makeReport([makeCase('parsing/empty', 10, { work: { MB: 100 } })]),
    ];

    const summary = compareReports(before, after, baseOpts);
    assert.equal(summary.passed, true);
    assert.equal(summary.comparisons[0].sizeChanged, false);
    assert.equal(summary.comparisons[0].deltaPct, 0);
  });

  test('rejects mismatched report counts, non-positive p50, and invalid thresholds', () => {
    const r1 = makeReport([makeCase('parsing/a', 100)]);
    const r2 = makeReport([makeCase('parsing/a', 100)]);

    assert.throws(() => compareReports([r1, r2], [r1], baseOpts), /Mismatched/);
    assert.throws(
      () =>
        compareReports(
          [makeReport([makeCase('parsing/a', 0)])],
          [r1],
          baseOpts,
        ),
      /non-positive/,
    );
    assert.throws(
      () => compareReports([r1], [r1], { ...baseOpts, warnThresholdPct: NaN }),
      /warnThresholdPct/,
    );
    assert.throws(
      () =>
        compareReports([r1], [r1], {
          ...baseOpts,
          warnThresholdPct: 10,
          failThresholdPct: 5,
        }),
      /failThresholdPct/,
    );
  });

  test('renders consistent retry badges in markdown', () => {
    const before = [
      makeReport([
        makeCase('parsing/pass', 100),
        makeCase('parsing/faster', 100),
        makeCase('parsing/warn', 100),
        makeCase('parsing/fail', 100),
      ]),
    ];
    const after = [
      makeReport([
        makeCase('parsing/pass', 120),
        makeCase('parsing/faster', 120),
        makeCase('parsing/warn', 120),
        makeCase('parsing/fail', 120),
      ]),
    ];
    const retryAfter = [
      makeReport([
        makeCase('parsing/pass', 101),
        makeCase('parsing/faster', 90),
        makeCase('parsing/warn', 107),
        makeCase('parsing/fail', 115),
      ]),
    ];

    const summary = compareReports(before, after, {
      ...baseOpts,
      retryBefore: before,
      retryAfter,
    });
    const md = renderMarkdown(summary);
    assert.match(md, /PASS \(retry\)/);
    assert.match(md, /FASTER \(retry\)/);
    assert.match(md, /WARN \(retry\)/);
    assert.match(md, /FAIL \(retry\)/);
  });

  test('renders suite-grouped tables with per-suite unit columns', () => {
    const before = [
      makeReport([
        makeCase('parsing/a', 100, { work: { MB: 1, dirs: 1000 } }),
        makeCase('parsing/long-case-name', 50, { work: { MB: 0.5 } }),
        makeCase('booking/b', 50, { work: { dirs: 5000 } }),
      ]),
    ];
    const after = [
      makeReport([
        makeCase('parsing/a', 90, { work: { MB: 1, dirs: 1000 } }),
        makeCase('parsing/long-case-name', 51, { work: { MB: 0.5 } }),
        makeCase('booking/b', 51, { work: { dirs: 5000 } }),
      ]),
    ];

    const summary = compareReports(before, after, baseOpts);

    const text = renderText(summary);
    assert.match(text, /=== Benchmark Report — PASS ===/);
    assert.match(text, /\[parsing\]/);
    assert.match(text, /\[booking\]/);
    assert.doesNotMatch(text, /\| :--- \|/);

    const lines = text.split('\n');
    const parsingIdx = lines.indexOf('[parsing]');
    const bookingIdx = lines.indexOf('[booking]');
    assert.ok(parsingIdx !== -1 && bookingIdx !== -1);
    const parsingHeader = lines[parsingIdx + 1];
    const bookingHeader = lines[bookingIdx + 1];
    assert.match(parsingHeader, /MB\/s/);
    assert.match(parsingHeader, /dirs\/s/);
    assert.match(bookingHeader, /dirs\/s/);
    assert.doesNotMatch(bookingHeader, /MB\/s/);

    const rowA = lines.find(l => l.startsWith('parsing/a'));
    const rowLong = lines.find(l => l.startsWith('parsing/long-case-name'));
    assert.ok(rowA && rowLong);
    assert.equal(parsingHeader.indexOf('Group'), rowA.indexOf('mixed'));
    assert.equal(parsingHeader.indexOf('Group'), rowLong.indexOf('mixed'));

    const md = renderMarkdown(summary);
    assert.match(md, /#### `parsing`/);
    assert.match(md, /#### `booking`/);
    assert.match(md, /\| MB\/s \| dirs\/s \|/);
    assert.match(md, /\| dirs\/s \| Delta \|/);
  });

  test('validates benchmark report schemaVersion', () => {
    assert.doesNotThrow(() =>
      validateBenchReport(makeReport([makeCase('parsing/a', 10)]), 'valid'),
    );
    assert.throws(
      () =>
        validateBenchReport(
          { schemaVersion: 2, cases: [], scalingChecks: [] },
          'bad',
        ),
      /schemaVersion/,
    );
  });
});
