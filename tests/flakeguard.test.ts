import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { detectSuspects } from '../src/detector';
import { loadHistory, mergeRunIntoHistory } from '../src/history';
import { runAction } from '../src/index';
import { parseJUnitReports } from '../src/junit';
import { buildSummary } from '../src/summary';
import type { ActionRuntime, HistorySnapshot } from '../src/types';

describe('JUnit parsing and rolling history', () => {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'junit-sample.xml');

  it('parses comma-separated JUnit report paths into normalized test outcomes', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'flakeguard-parse-'));
    const extraReportPath = path.join(tempDir, 'extra.xml');

    await writeFile(
      extraReportPath,
      `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="extra" tests="1">
  <testcase classname="calculator.AdditionTest" name="adds numbers" />
</testsuite>
`
    );

    const report = await parseJUnitReports(`${fixturePath}, ${extraReportPath}`);

    expect(report.sourceFiles).toEqual([fixturePath, extraReportPath]);
    expect(report.totals).toEqual({ total: 4, passed: 2, failed: 1, skipped: 1 });
    expect(report.tests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'calculator.AdditionTest::adds numbers',
          classname: 'calculator.AdditionTest',
          name: 'adds numbers',
          status: 'passed',
        }),
        expect.objectContaining({
          id: 'calculator.SubtractionTest::subtracts numbers',
          status: 'failed',
        }),
        expect.objectContaining({
          id: 'calculator.DivisionTest::skips on zero divisor',
          status: 'skipped',
        }),
      ])
    );

    await rm(tempDir, { recursive: true, force: true });
  });

  it('resolves globbed JUnit paths', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'flakeguard-glob-'));
    const reportAPath = path.join(tempDir, 'a.xml');
    const reportBPath = path.join(tempDir, 'b.xml');

    await writeFile(
      reportAPath,
      `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="a" tests="1">
  <testcase classname="suite.A" name="passes" />
</testsuite>
`
    );
    await writeFile(
      reportBPath,
      `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="b" tests="1">
  <testcase classname="suite.B" name="fails">
    <failure message="boom">boom</failure>
  </testcase>
</testsuite>
`
    );

    const report = await parseJUnitReports(path.join(tempDir, '*.xml'));

    expect(report.sourceFiles).toEqual([reportAPath, reportBPath]);
    expect(report.totals).toEqual({ total: 2, passed: 1, failed: 1, skipped: 0 });

    await rm(tempDir, { recursive: true, force: true });
  });

  it('loads empty history when the history file does not exist', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'flakeguard-history-'));
    const historyFile = path.join(tempDir, 'history.json');

    const history = await loadHistory(historyFile, 3);

    expect(history).toEqual({
      version: 1,
      maxRuns: 3,
      updatedAt: '',
      runs: [],
      tests: {},
    });

    await rm(tempDir, { recursive: true, force: true });
  });

  it('merges a run into history and caps stored runs per test', async () => {
    const initialHistory = await loadHistory(path.join(os.tmpdir(), 'flakeguard-unused-history.json'), 2);
    const failingReport = await parseJUnitReports(fixturePath);
    const passingReportDir = await mkdtemp(path.join(os.tmpdir(), 'flakeguard-pass-'));
    const passingReportPath = path.join(passingReportDir, 'passing.xml');
    const failedAgainReportPath = path.join(passingReportDir, 'failed-again.xml');

    await writeFile(
      passingReportPath,
      `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="passing" tests="1">
  <testcase classname="calculator.SubtractionTest" name="subtracts numbers" />
</testsuite>
`
    );

    await writeFile(
      failedAgainReportPath,
      `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="failedAgain" tests="1">
  <testcase classname="calculator.SubtractionTest" name="subtracts numbers">
    <failure message="still flaky">still flaky</failure>
  </testcase>
</testsuite>
`
    );

    const historyAfterFirstRun = mergeRunIntoHistory(initialHistory, failingReport, {
      runId: 'run-1',
      timestamp: '2026-04-19T20:00:00.000Z',
      maxRuns: 2,
    });
    const historyAfterSecondRun = mergeRunIntoHistory(
      historyAfterFirstRun,
      await parseJUnitReports(passingReportPath),
      {
        runId: 'run-2',
        timestamp: '2026-04-19T20:10:00.000Z',
        maxRuns: 2,
      }
    );
    const historyAfterThirdRun = mergeRunIntoHistory(
      historyAfterSecondRun,
      await parseJUnitReports(failedAgainReportPath),
      {
        runId: 'run-3',
        timestamp: '2026-04-19T20:20:00.000Z',
        maxRuns: 2,
      }
    );

    expect(historyAfterThirdRun.runs.map(run => run.runId)).toEqual(['run-2', 'run-3']);
    expect(historyAfterThirdRun.tests['calculator.SubtractionTest::subtracts numbers'].recent).toEqual([
      {
        runId: 'run-2',
        timestamp: '2026-04-19T20:10:00.000Z',
        status: 'passed',
      },
      {
        runId: 'run-3',
        timestamp: '2026-04-19T20:20:00.000Z',
        status: 'failed',
      },
    ]);
    expect(historyAfterThirdRun.updatedAt).toBe('2026-04-19T20:20:00.000Z');

    await rm(passingReportDir, { recursive: true, force: true });
  });

  it('loads existing JSON history from disk', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'flakeguard-existing-history-'));
    const historyFile = path.join(tempDir, 'history.json');
    const historyJson = {
      version: 1,
      maxRuns: 4,
      updatedAt: '2026-04-18T00:00:00.000Z',
      runs: [
        {
          runId: 'run-a',
          timestamp: '2026-04-18T00:00:00.000Z',
          sourceFiles: ['fixture.xml'],
          totals: { total: 1, passed: 1, failed: 0, skipped: 0 },
        },
      ],
      tests: {
        'suite.Test::works': {
          id: 'suite.Test::works',
          classname: 'suite.Test',
          name: 'works',
          recent: [
            {
              runId: 'run-a',
              timestamp: '2026-04-18T00:00:00.000Z',
              status: 'passed',
            },
          ],
        },
      },
    };

    await writeFile(historyFile, JSON.stringify(historyJson, null, 2));

    const history = await loadHistory(historyFile, 4);
    const roundTrip = JSON.parse(await readFile(historyFile, 'utf8'));

    expect(history).toEqual(historyJson);
    expect(roundTrip).toEqual(historyJson);
    await rm(tempDir, { recursive: true, force: true });
  });
});

describe('flake detection and summary rendering', () => {
  function createHistoryFixture(): HistorySnapshot {
    return {
      version: 1,
      maxRuns: 5,
      updatedAt: '2026-04-19T20:30:00.000Z',
      runs: [
        {
          runId: 'run-1',
          timestamp: '2026-04-19T20:00:00.000Z',
          sourceFiles: ['a.xml'],
          totals: { total: 3, passed: 1, failed: 2, skipped: 0 },
        },
        {
          runId: 'run-2',
          timestamp: '2026-04-19T20:10:00.000Z',
          sourceFiles: ['b.xml'],
          totals: { total: 3, passed: 1, failed: 2, skipped: 0 },
        },
        {
          runId: 'run-3',
          timestamp: '2026-04-19T20:30:00.000Z',
          sourceFiles: ['c.xml'],
          totals: { total: 3, passed: 1, failed: 2, skipped: 0 },
        },
      ],
      tests: {
        'suite.Flake::toggles': {
          id: 'suite.Flake::toggles',
          classname: 'suite.Flake',
          name: 'toggles',
          recent: [
            { runId: 'run-1', timestamp: '2026-04-19T20:00:00.000Z', status: 'passed' },
            { runId: 'run-2', timestamp: '2026-04-19T20:10:00.000Z', status: 'failed' },
            { runId: 'run-3', timestamp: '2026-04-19T20:30:00.000Z', status: 'failed' },
          ],
        },
        'suite.Broken::always fails': {
          id: 'suite.Broken::always fails',
          classname: 'suite.Broken',
          name: 'always fails',
          recent: [
            { runId: 'run-1', timestamp: '2026-04-19T20:00:00.000Z', status: 'failed' },
            { runId: 'run-2', timestamp: '2026-04-19T20:10:00.000Z', status: 'failed' },
            { runId: 'run-3', timestamp: '2026-04-19T20:30:00.000Z', status: 'failed' },
          ],
        },
        'suite.Healed::recently passed': {
          id: 'suite.Healed::recently passed',
          classname: 'suite.Healed',
          name: 'recently passed',
          recent: [
            { runId: 'run-1', timestamp: '2026-04-19T20:00:00.000Z', status: 'failed' },
            { runId: 'run-2', timestamp: '2026-04-19T20:10:00.000Z', status: 'passed' },
          ],
        },
      },
    };
  }

  it('marks suspect flakes and ranks categories in the expected order', () => {
    const detection = detectSuspects(createHistoryFixture(), 2);

    expect(detection.suspects.map(test => test.id)).toEqual(['suite.Flake::toggles']);
    expect(detection.stableFailures.map(test => test.id)).toEqual(['suite.Broken::always fails']);
    expect(detection.newlyPassing.map(test => test.id)).toEqual(['suite.Healed::recently passed']);
    expect(detection.ranked.map(test => test.id)).toEqual([
      'suite.Flake::toggles',
      'suite.Broken::always fails',
      'suite.Healed::recently passed',
    ]);
  });

  it('renders markdown summary sections for totals, suspects, stable failures, and history updates', () => {
    const history = createHistoryFixture();
    const summary = buildSummary(
      { total: 3, passed: 1, failed: 2, skipped: 0 },
      detectSuspects(history, 2),
      history,
      '/tmp/history.json'
    );

    expect(summary).toContain('# FlakeGuard Summary');
    expect(summary).toContain('## Current run totals');
    expect(summary).toContain('## Suspect flakes');
    expect(summary).toContain('suite.Flake::toggles');
    expect(summary).toContain('## Stable failures');
    expect(summary).toContain('suite.Broken::always fails');
    expect(summary).toContain('Updated history file: `/tmp/history.json`');
  });
});

describe('action integration', () => {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'junit-sample.xml');
  const multiRunFixturePaths = [
    path.join(__dirname, '..', 'fixtures', 'multi-run', 'run-1.xml'),
    path.join(__dirname, '..', 'fixtures', 'multi-run', 'run-2.xml'),
    path.join(__dirname, '..', 'fixtures', 'multi-run', 'run-3.xml'),
  ];

  it('writes summary and history files, appends step summary, and emits outputs', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'flakeguard-action-'));
    const historyFile = path.join(tempDir, 'history.json');
    const stepSummaryPath = path.join(tempDir, 'step-summary.md');
    const outputs: Record<string, string> = {};

    const priorHistory: HistorySnapshot = {
      version: 1,
      maxRuns: 5,
      updatedAt: '2026-04-19T20:10:00.000Z',
      runs: [
        {
          runId: 'run-1',
          timestamp: '2026-04-19T20:00:00.000Z',
          sourceFiles: [fixturePath],
          totals: { total: 1, passed: 1, failed: 0, skipped: 0 },
        },
        {
          runId: 'run-2',
          timestamp: '2026-04-19T20:10:00.000Z',
          sourceFiles: [fixturePath],
          totals: { total: 1, passed: 0, failed: 1, skipped: 0 },
        },
      ],
      tests: {
        'calculator.SubtractionTest::subtracts numbers': {
          id: 'calculator.SubtractionTest::subtracts numbers',
          classname: 'calculator.SubtractionTest',
          name: 'subtracts numbers',
          recent: [
            { runId: 'run-1', timestamp: '2026-04-19T20:00:00.000Z', status: 'passed' },
            { runId: 'run-2', timestamp: '2026-04-19T20:10:00.000Z', status: 'failed' },
          ],
        },
      },
    };

    await writeFile(historyFile, JSON.stringify(priorHistory, null, 2));

    const runtime: ActionRuntime = {
      getInput(name: string) {
        const inputs: Record<string, string> = {
          report_paths: fixturePath,
          history_file: historyFile,
          max_runs: '5',
          suspect_threshold: '2',
        };
        return inputs[name] ?? '';
      },
      setOutput(name: string, value: string) {
        outputs[name] = value;
      },
      setFailed(message: string) {
        throw new Error(message);
      },
      cwd: tempDir,
      workspace: tempDir,
      stepSummaryPath,
      now: () => new Date('2026-04-19T20:30:00.000Z'),
      log: () => undefined,
    };

    const result = await runAction(runtime);
    const summaryMarkdown = await readFile(result.summaryPath, 'utf8');
    const updatedHistory = JSON.parse(await readFile(historyFile, 'utf8')) as HistorySnapshot;
    const appendedStepSummary = await readFile(stepSummaryPath, 'utf8');

    expect(result.suspectCount).toBe(1);
    expect(result.historyPath).toBe(historyFile);
    expect(result.summaryPath).toBe(path.join(tempDir, 'flakeguard-summary.md'));
    expect(outputs).toEqual({
      suspect_count: '1',
      summary_path: path.join(tempDir, 'flakeguard-summary.md'),
      history_path: historyFile,
    });
    expect(summaryMarkdown).toContain('calculator.SubtractionTest::subtracts numbers');
    expect(appendedStepSummary).toContain('# FlakeGuard Summary');
    expect(updatedHistory.runs.map(run => run.runId)).toEqual(['run-1', 'run-2', '2026-04-19T20:30:00.000Z']);
    expect(updatedHistory.tests['calculator.SubtractionTest::subtracts numbers'].recent).toEqual([
      { runId: 'run-1', timestamp: '2026-04-19T20:00:00.000Z', status: 'passed' },
      { runId: 'run-2', timestamp: '2026-04-19T20:10:00.000Z', status: 'failed' },
      { runId: '2026-04-19T20:30:00.000Z', timestamp: '2026-04-19T20:30:00.000Z', status: 'failed' },
    ]);

    await rm(tempDir, { recursive: true, force: true });
  });

  it('persists history across repeated runs and flags a suspect flake on the third run', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'flakeguard-cross-run-'));
    const historyFile = path.join(tempDir, '.flakeguard', 'history.json');
    const stepSummaryPath = path.join(tempDir, 'step-summary.md');
    const originalRunId = process.env.GITHUB_RUN_ID;
    let finalOutputs: Record<string, string> = {};

    try {
      const timestamps = [
        '2026-04-20T00:00:00.000Z',
        '2026-04-20T00:10:00.000Z',
        '2026-04-20T00:20:00.000Z',
      ];

      for (const [index, reportPath] of multiRunFixturePaths.entries()) {
        const outputs: Record<string, string> = {};
        process.env.GITHUB_RUN_ID = `run-${index + 1}`;

        await runAction({
          getInput(name: string) {
            const inputs: Record<string, string> = {
              report_paths: reportPath,
              history_file: historyFile,
              max_runs: '5',
              suspect_threshold: '2',
            };
            return inputs[name] ?? '';
          },
          setOutput(name: string, value: string) {
            outputs[name] = value;
          },
          setFailed(message: string) {
            throw new Error(message);
          },
          cwd: tempDir,
          workspace: tempDir,
          stepSummaryPath,
          now: () => new Date(timestamps[index]),
          log: () => undefined,
        });

        finalOutputs = outputs;
      }

      const summaryPath = path.join(tempDir, '.flakeguard', 'flakeguard-summary.md');
      const summaryMarkdown = await readFile(summaryPath, 'utf8');
      const updatedHistory = JSON.parse(await readFile(historyFile, 'utf8')) as HistorySnapshot;

      expect(finalOutputs).toEqual({
        suspect_count: '1',
        summary_path: summaryPath,
        history_path: historyFile,
      });
      expect(updatedHistory.runs.map(run => run.runId)).toEqual(['run-1', 'run-2', 'run-3']);
      expect(updatedHistory.tests['suite.Flake::toggles'].recent).toEqual([
        { runId: 'run-1', timestamp: '2026-04-20T00:00:00.000Z', status: 'failed' },
        { runId: 'run-2', timestamp: '2026-04-20T00:10:00.000Z', status: 'passed' },
        { runId: 'run-3', timestamp: '2026-04-20T00:20:00.000Z', status: 'failed' },
      ]);
      expect(summaryMarkdown).toContain('## Suspect flakes');
      expect(summaryMarkdown).toContain('`suite.Flake::toggles` — latest: **failed**, passes: 1, failures: 2');
    } finally {
      if (originalRunId === undefined) {
        delete process.env.GITHUB_RUN_ID;
      } else {
        process.env.GITHUB_RUN_ID = originalRunId;
      }
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
