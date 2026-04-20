export type TestStatus = 'passed' | 'failed' | 'skipped';

export interface NormalizedTestCase {
  id: string;
  classname: string;
  name: string;
  status: TestStatus;
  sourceFile: string;
}

export interface RunTotals {
  passed: number;
  failed: number;
  skipped: number;
  total: number;
}

export interface ParsedReport {
  sourceFiles: string[];
  tests: NormalizedTestCase[];
  totals: RunTotals;
}

export interface RunRecord {
  runId: string;
  timestamp: string;
  sourceFiles: string[];
  totals: RunTotals;
}

export interface HistoryEvent {
  runId: string;
  timestamp: string;
  status: TestStatus;
}

export interface TestHistoryRecord {
  id: string;
  classname: string;
  name: string;
  recent: HistoryEvent[];
}

export interface HistorySnapshot {
  version: 1;
  maxRuns: number;
  updatedAt: string;
  runs: RunRecord[];
  tests: Record<string, TestHistoryRecord>;
}

export interface MergeRunOptions {
  runId: string;
  timestamp: string;
  maxRuns: number;
}

export interface RankedTestRecord {
  id: string;
  classname: string;
  name: string;
  latestStatus: TestStatus;
  passes: number;
  failures: number;
  skips: number;
  recent: HistoryEvent[];
}

export interface DetectionResult {
  suspects: RankedTestRecord[];
  stableFailures: RankedTestRecord[];
  newlyPassing: RankedTestRecord[];
  ranked: RankedTestRecord[];
}

export interface ActionResult {
  summaryPath: string;
  historyPath: string;
  suspectCount: number;
}

export interface ActionInputs {
  reportPaths: string;
  historyFile: string;
  maxRuns: number;
  suspectThreshold: number;
}

export interface ActionRuntime {
  getInput(name: string, options?: { required?: boolean }): string;
  setOutput(name: string, value: string): void;
  setFailed(message: string): void;
  cwd: string;
  workspace?: string;
  stepSummaryPath?: string;
  now(): Date;
  log(message: string): void;
}
