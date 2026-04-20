import type { DetectionResult, HistorySnapshot, RankedTestRecord, RunTotals } from './types';

function formatRecentStatuses(record: RankedTestRecord): string {
  return record.recent.map(event => event.status[0].toUpperCase()).join(' → ');
}

function renderSection(title: string, records: RankedTestRecord[], emptyMessage: string): string {
  if (records.length === 0) {
    return `## ${title}\n\n${emptyMessage}`;
  }

  const lines = records.map(
    record =>
      `- \`${record.id}\` — latest: **${record.latestStatus}**, passes: ${record.passes}, failures: ${record.failures}, recent: ${formatRecentStatuses(record)}`
  );

  return [`## ${title}`, '', ...lines].join('\n');
}

export function buildSummary(
  totals: RunTotals,
  detection: DetectionResult,
  history: HistorySnapshot,
  historyPath: string
): string {
  const sections = [
    '# FlakeGuard Summary',
    '',
    '## Current run totals',
    '',
    `- Total: ${totals.total}`,
    `- Passed: ${totals.passed}`,
    `- Failed: ${totals.failed}`,
    `- Skipped: ${totals.skipped}`,
    '',
    renderSection('Suspect flakes', detection.suspects, 'No suspect flakes detected in the current rolling window.'),
    '',
    renderSection('Stable failures', detection.stableFailures, 'No stable failures detected.'),
  ];

  if (detection.newlyPassing.length > 0) {
    sections.push('', renderSection('Newly passing tests', detection.newlyPassing, 'No newly passing tests detected.'));
  }

  sections.push(
    '',
    '## History update',
    '',
    `Updated history file: \`${historyPath}\``,
    `History window: last ${history.maxRuns} run(s).`,
    history.updatedAt ? `History updated at: ${history.updatedAt}` : 'History updated at: pending',
    ''
  );

  return sections.join('\n');
}
