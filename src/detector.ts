import type { DetectionResult, HistorySnapshot, RankedTestRecord } from './types';

function summarizeRecord(record: HistorySnapshot['tests'][string]): RankedTestRecord {
  const passes = record.recent.filter(event => event.status === 'passed').length;
  const failures = record.recent.filter(event => event.status === 'failed').length;
  const skips = record.recent.filter(event => event.status === 'skipped').length;
  const latestStatus = record.recent[record.recent.length - 1]?.status ?? 'skipped';

  return {
    id: record.id,
    classname: record.classname,
    name: record.name,
    latestStatus,
    passes,
    failures,
    skips,
    recent: record.recent,
  };
}

function compareRankedTests(left: RankedTestRecord, right: RankedTestRecord): number {
  if (right.failures !== left.failures) {
    return right.failures - left.failures;
  }
  if (right.passes !== left.passes) {
    return right.passes - left.passes;
  }
  if (right.recent.length !== left.recent.length) {
    return right.recent.length - left.recent.length;
  }
  return left.id.localeCompare(right.id);
}

export function detectSuspects(history: HistorySnapshot, suspectThreshold: number): DetectionResult {
  const summarizedRecords = Object.values(history.tests).map(summarizeRecord);

  const suspects = summarizedRecords
    .filter(record => record.passes > 0 && record.failures >= suspectThreshold)
    .sort(compareRankedTests);

  const stableFailures = summarizedRecords
    .filter(record => record.latestStatus === 'failed' && record.passes === 0)
    .sort(compareRankedTests);

  const newlyPassing = summarizedRecords
    .filter(record => record.latestStatus === 'passed' && record.failures > 0)
    .sort(compareRankedTests);

  const knownIds = new Set([
    ...suspects.map(record => record.id),
    ...stableFailures.map(record => record.id),
    ...newlyPassing.map(record => record.id),
  ]);

  const remaining = summarizedRecords
    .filter(record => !knownIds.has(record.id))
    .sort(compareRankedTests);

  return {
    suspects,
    stableFailures,
    newlyPassing,
    ranked: [...suspects, ...stableFailures, ...newlyPassing, ...remaining],
  };
}
