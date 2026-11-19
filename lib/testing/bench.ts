export interface BenchCase {
  readonly id: string;
  readonly group: string;
  readonly description: string;
  /** Work performed per iteration, keyed by unit (e.g. `{ MB: 6.0, dirs: 50000 }`). */
  readonly work?: Readonly<Record<string, number>>;
  readonly heavy?: boolean;
  readonly run: () => unknown;
}

export interface ScalingExpectation {
  readonly id: string;
  readonly label: string;
  readonly smallId: string;
  readonly largeId: string;
  /** Work unit used to compute sizeRatio (defaults to first shared work unit). */
  readonly sizeUnit?: string;
  /** Explicit size ratio override (takes precedence over sizeUnit). */
  readonly sizeRatio?: number;
  readonly maxNormalizedRatio: number;
}

export interface BenchSuite {
  readonly name: string;
  readonly cases: readonly BenchCase[];
  readonly scalingChecks?: readonly ScalingExpectation[];
}
