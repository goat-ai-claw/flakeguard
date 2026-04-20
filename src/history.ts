import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { HistorySnapshot, MergeRunOptions, ParsedReport, TestHistoryRecord } from './types';

export function createEmptyHistory(maxRuns: number): HistorySnapshot {
  return {
    version: 1,
    maxRuns,
    updatedAt: '',
    runs: [],
    tests: {},
  };
}

export async function loadHistory(historyFile: string, maxRuns: number): Promise<HistorySnapshot> {
  try {
    const raw = await readFile(historyFile, 'utf8');
    const parsed = JSON.parse(raw) as HistorySnapshot;
    return {
      version: 1,
      maxRuns: parsed.maxRuns ?? maxRuns,
      updatedAt: parsed.updatedAt ?? '',
      runs: parsed.runs ?? [],
      tests: parsed.tests ?? {},
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return createEmptyHistory(maxRuns);
    }
    throw error;
  }
}

function trimHistoryRecord(record: TestHistoryRecord, allowedRunIds: Set<string>): TestHistoryRecord | undefined {
  const recent = record.recent.filter(event => allowedRunIds.has(event.runId));
  if (recent.length === 0) {
    return undefined;
  }

  return {
    ...record,
    recent,
  };
}

export function mergeRunIntoHistory(
  history: HistorySnapshot,
  report: ParsedReport,
  options: MergeRunOptions
): HistorySnapshot {
  const runRecord = {
    runId: options.runId,
    timestamp: options.timestamp,
    sourceFiles: report.sourceFiles,
    totals: report.totals,
  };

  const runs = [...history.runs, runRecord].slice(-options.maxRuns);
  const allowedRunIds = new Set(runs.map(run => run.runId));
  const tests: Record<string, TestHistoryRecord> = {};

  for (const [id, record] of Object.entries(history.tests)) {
    const trimmed = trimHistoryRecord(record, allowedRunIds);
    if (trimmed) {
      tests[id] = trimmed;
    }
  }

  const uniqueCurrentTests = new Map(report.tests.map(test => [test.id, test]));
  for (const test of uniqueCurrentTests.values()) {
    const existingRecord = tests[test.id] ?? {
      id: test.id,
      classname: test.classname,
      name: test.name,
      recent: [],
    };

    const recent = [...existingRecord.recent, {
      runId: options.runId,
      timestamp: options.timestamp,
      status: test.status,
    }].filter(event => allowedRunIds.has(event.runId));

    tests[test.id] = {
      ...existingRecord,
      classname: test.classname,
      name: test.name,
      recent,
    };
  }

  return {
    version: 1,
    maxRuns: options.maxRuns,
    updatedAt: options.timestamp,
    runs,
    tests,
  };
}

export async function saveHistory(historyFile: string, history: HistorySnapshot): Promise<void> {
  await mkdir(path.dirname(historyFile), { recursive: true });
  await writeFile(historyFile, JSON.stringify(history, null, 2));
}
