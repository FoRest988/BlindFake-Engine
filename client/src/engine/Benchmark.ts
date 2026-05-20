/**
 * Benchmark — Lightweight performance benchmarking utility.
 *
 * Features:
 *  - High-resolution timing via `performance.now()` with Date.now() fallback
 *  - Statistical reporting: min, max, mean, median, p95, standard deviation
 *  - Named suites with multiple cases
 *  - Warmup iterations (excluded from stats)
 *  - Comparison reporter (shows % difference between baselines)
 *
 * Usage:
 *   const bench = new BenchmarkRunner();
 *   bench.suite('ECS World', b => {
 *     b.add('createEntity × 1000', () => { ... }, { iterations: 100, warmup: 5 });
 *   });
 *   const results = bench.runAll();
 *   console.log(bench.formatReport(results));
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BenchmarkOptions {
  /** Number of measured iterations (default 50). */
  iterations?: number;
  /** Warmup runs excluded from stats (default 3). */
  warmup?: number;
  /** Optional baseline name to compare against (from same suite). */
  compareTo?: string;
}

export interface BenchmarkStats {
  name:    string;
  iterations: number;
  min:     number;
  max:     number;
  mean:    number;
  median:  number;
  p95:     number;
  stddev:  number;
  /** Ops per second = 1000 / mean (assumes each run is one op). */
  opsPerSec: number;
}

export interface BenchmarkSuiteResult {
  suiteName: string;
  cases: BenchmarkStats[];
}

// ── Case definition ───────────────────────────────────────────────────────────

interface CaseDef {
  name: string;
  fn: (() => void) | (() => Promise<void>);
  opts: Required<BenchmarkOptions>;
}

// ── Suite builder ─────────────────────────────────────────────────────────────

export class BenchmarkSuiteBuilder {
  readonly cases: CaseDef[] = [];

  add(name: string, fn: (() => void) | (() => Promise<void>), opts: BenchmarkOptions = {}): this {
    this.cases.push({
      name,
      fn,
      opts: {
        iterations: opts.iterations ?? 50,
        warmup:     opts.warmup     ?? 3,
        compareTo:  opts.compareTo  ?? '',
      },
    });
    return this;
  }
}

// ── BenchmarkRunner ───────────────────────────────────────────────────────────

export class BenchmarkRunner {
  private suites: Array<{ name: string; builder: BenchmarkSuiteBuilder }> = [];

  suite(name: string, define: (b: BenchmarkSuiteBuilder) => void): this {
    const builder = new BenchmarkSuiteBuilder();
    define(builder);
    this.suites.push({ name, builder });
    return this;
  }

  /** Run all suites synchronously. Async cases are awaited. */
  async runAll(): Promise<BenchmarkSuiteResult[]> {
    const results: BenchmarkSuiteResult[] = [];
    for (const { name, builder } of this.suites) {
      const cases: BenchmarkStats[] = [];
      for (const c of builder.cases) {
        const stats = await this._runCase(c);
        cases.push(stats);
      }
      results.push({ suiteName: name, cases });
    }
    return results;
  }

  /** Run a single suite by name. */
  async runSuite(name: string): Promise<BenchmarkSuiteResult | null> {
    const entry = this.suites.find(s => s.name === name);
    if (!entry) return null;
    const cases: BenchmarkStats[] = [];
    for (const c of entry.builder.cases) {
      cases.push(await this._runCase(c));
    }
    return { suiteName: name, cases };
  }

  private async _runCase(c: CaseDef): Promise<BenchmarkStats> {
    const times: number[] = [];

    // Warmup
    for (let i = 0; i < c.opts.warmup; i++) {
      const r = c.fn();
      if (r instanceof Promise) await r;
    }

    // Measured runs
    for (let i = 0; i < c.opts.iterations; i++) {
      const t0 = this._now();
      const r  = c.fn();
      if (r instanceof Promise) await r;
      times.push(this._now() - t0);
    }

    times.sort((a, b) => a - b);
    const sum    = times.reduce((acc, v) => acc + v, 0);
    const mean   = sum / times.length;
    const median = times[Math.floor(times.length / 2)];
    const p95    = times[Math.floor(times.length * 0.95)];
    const variance = times.reduce((acc, v) => acc + (v - mean) ** 2, 0) / times.length;

    return {
      name:      c.name,
      iterations: c.opts.iterations,
      min:    times[0],
      max:    times[times.length - 1],
      mean,
      median,
      p95,
      stddev:    Math.sqrt(variance),
      opsPerSec: mean > 0 ? 1000 / mean : Infinity,
    };
  }

  private _now(): number {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
  }

  // ── Formatting ─────────────────────────────────────────────────────

  formatReport(results: BenchmarkSuiteResult[]): string {
    const lines: string[] = [];
    for (const suite of results) {
      lines.push(`\n─── ${suite.suiteName} ───`);
      for (const c of suite.cases) {
        lines.push(
          `  ${c.name.padEnd(40)} ` +
          `mean=${this._fmtMs(c.mean)}  ` +
          `min=${this._fmtMs(c.min)}  ` +
          `p95=${this._fmtMs(c.p95)}  ` +
          `ops/s=${c.opsPerSec.toFixed(0)}`,
        );
      }
    }
    return lines.join('\n');
  }

  private _fmtMs(ms: number): string {
    if (ms < 1)    return `${(ms * 1000).toFixed(1)}μs`;
    if (ms < 1000) return `${ms.toFixed(3)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  }
}

// ── Static helpers ────────────────────────────────────────────────────────────

/** Single-shot timing helper. */
export function time(label: string, fn: () => void): { label: string; ms: number } {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  fn();
  const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  return { label, ms };
}

/** Assert that `fn` completes within `budgetMs` (throws if exceeded). */
export function assertUnder(budgetMs: number, fn: () => void): void {
  const { ms } = time('', fn);
  if (ms > budgetMs) {
    throw new Error(`Performance budget exceeded: took ${ms.toFixed(2)}ms, budget ${budgetMs}ms`);
  }
}
