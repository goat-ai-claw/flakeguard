const { mkdir, readFile, rm } = require('node:fs/promises');
const path = require('node:path');
const { runAction } = require('../dist/index.js');

const projectRoot = path.resolve(__dirname, '..');
const demoRoot = path.join(projectRoot, 'demo-output');
const outputDir = path.join(demoRoot, 'cross-run');
const stepSummaryPath = path.join(outputDir, 'step-summary.md');
const historyRelativePath = '.flakeguard/history.json';
const historyPath = path.join(outputDir, historyRelativePath);

const runs = [
  {
    reportPath: path.join(projectRoot, 'fixtures', 'multi-run', 'run-1.xml'),
    runId: 'demo-run-1',
    timestamp: '2026-04-20T00:00:00.000Z',
  },
  {
    reportPath: path.join(projectRoot, 'fixtures', 'multi-run', 'run-2.xml'),
    runId: 'demo-run-2',
    timestamp: '2026-04-20T00:10:00.000Z',
  },
  {
    reportPath: path.join(projectRoot, 'fixtures', 'multi-run', 'run-3.xml'),
    runId: 'demo-run-3',
    timestamp: '2026-04-20T00:20:00.000Z',
  },
];

async function main() {
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });

  const originalRunId = process.env.GITHUB_RUN_ID;

  try {
    for (const run of runs) {
      process.env.GITHUB_RUN_ID = run.runId;

      await runAction({
        getInput(name) {
          const inputs = {
            report_paths: run.reportPath,
            history_file: historyRelativePath,
            max_runs: '5',
            suspect_threshold: '2',
          };
          return inputs[name] || '';
        },
        setOutput() {},
        setFailed(message) {
          throw new Error(message);
        },
        cwd: outputDir,
        workspace: outputDir,
        stepSummaryPath,
        now: () => new Date(run.timestamp),
        log() {},
      });
    }
  } finally {
    if (originalRunId === undefined) {
      delete process.env.GITHUB_RUN_ID;
    } else {
      process.env.GITHUB_RUN_ID = originalRunId;
    }
  }

  const summaryPath = path.join(outputDir, '.flakeguard', 'flakeguard-summary.md');
  const summary = await readFile(summaryPath, 'utf8');
  const history = JSON.parse(await readFile(historyPath, 'utf8'));

  console.log(`Wrote multi-run demo to ${outputDir}`);
  console.log(`Summary path: ${summaryPath}`);
  console.log(`History path: ${historyPath}`);
  console.log(`Tracked runs: ${history.runs.length}`);
  console.log(summary);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
