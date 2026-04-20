import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as core from '@actions/core';
import { detectSuspects } from './detector';
import { loadHistory, mergeRunIntoHistory, saveHistory } from './history';
import { parseJUnitReports } from './junit';
import { buildSummary } from './summary';
import type { ActionInputs, ActionResult, ActionRuntime } from './types';

function createRuntime(): ActionRuntime {
  return {
    getInput: (name, options) => core.getInput(name, options),
    setOutput: (name, value) => core.setOutput(name, value),
    setFailed: message => core.setFailed(message),
    cwd: process.cwd(),
    workspace: process.env.GITHUB_WORKSPACE,
    stepSummaryPath: process.env.GITHUB_STEP_SUMMARY,
    now: () => new Date(),
    log: message => core.info(message),
  };
}

function parsePositiveInteger(value: string, inputName: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${inputName} must be a positive integer. Received: ${value}`);
  }
  return parsed;
}

function readInputs(runtime: ActionRuntime): ActionInputs {
  return {
    reportPaths: runtime.getInput('report_paths', { required: true }),
    historyFile: runtime.getInput('history_file', { required: true }),
    maxRuns: parsePositiveInteger(runtime.getInput('max_runs') || '10', 'max_runs'),
    suspectThreshold: parsePositiveInteger(
      runtime.getInput('suspect_threshold') || '2',
      'suspect_threshold'
    ),
  };
}

async function writeSummary(summaryPath: string, markdown: string, stepSummaryPath?: string): Promise<void> {
  await mkdir(path.dirname(summaryPath), { recursive: true });
  await writeFile(summaryPath, markdown);

  if (stepSummaryPath) {
    await mkdir(path.dirname(stepSummaryPath), { recursive: true });
    await appendFile(stepSummaryPath, `${markdown}\n`);
  }
}

export async function runAction(runtime: ActionRuntime = createRuntime()): Promise<ActionResult> {
  try {
    const inputs = readInputs(runtime);
    const workspace = runtime.workspace ?? runtime.cwd;
    const historyPath = path.resolve(workspace, inputs.historyFile);
    const summaryPath = path.join(path.dirname(historyPath), 'flakeguard-summary.md');
    const report = await parseJUnitReports(inputs.reportPaths, workspace);
    const history = await loadHistory(historyPath, inputs.maxRuns);
    const timestamp = runtime.now().toISOString();
    const runId = process.env.GITHUB_RUN_ID?.trim() || timestamp;
    const mergedHistory = mergeRunIntoHistory(history, report, {
      runId,
      timestamp,
      maxRuns: inputs.maxRuns,
    });
    const detection = detectSuspects(mergedHistory, inputs.suspectThreshold);
    const summaryMarkdown = buildSummary(report.totals, detection, mergedHistory, historyPath);

    await saveHistory(historyPath, mergedHistory);
    await writeSummary(summaryPath, summaryMarkdown, runtime.stepSummaryPath);

    runtime.setOutput('suspect_count', String(detection.suspects.length));
    runtime.setOutput('summary_path', summaryPath);
    runtime.setOutput('history_path', historyPath);
    runtime.log(
      `FlakeGuard processed ${report.totals.total} tests and flagged ${detection.suspects.length} suspect flake(s).`
    );

    return {
      summaryPath,
      historyPath,
      suspectCount: detection.suspects.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    runtime.setFailed(`FlakeGuard failed: ${message}`);
    throw error;
  }
}

if (require.main === module) {
  runAction().catch(() => {
    process.exitCode = 1;
  });
}
