# FlakeGuard

**GitHub Actions flaky-test triage for small teams.**

FlakeGuard is a local TypeScript GitHub Action that parses JUnit XML reports, keeps a rolling JSON history, flags likely flaky tests with simple deterministic rules, and writes a markdown summary you can review in the workflow UI.

## What it does

- Parses one or more JUnit XML files from explicit paths or glob patterns
- Normalizes tests as `classname::name`
- Tracks recent `passed`, `failed`, and `skipped` outcomes in a rolling history file
- Marks likely flaky tests when the recent window contains both passes and failures and the failure count reaches a threshold
- Writes a markdown summary file and appends it to `$GITHUB_STEP_SUMMARY` when available
- Exposes `suspect_count`, `summary_path`, and `history_path` as action outputs

## Minimal workflow example

```yaml
name: flakeguard

on:
  workflow_dispatch:

jobs:
  detect-flakes:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Run tests
        run: npm test -- --reporters=default --reporters=jest-junit

      - name: FlakeGuard
        uses: ./
        with:
          report_paths: 'reports/junit.xml'
          history_file: '.flakeguard/history.json'
          max_runs: '10'
          suspect_threshold: '2'
```

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `report_paths` | — | Comma-separated JUnit XML files or glob patterns. |
| `history_file` | `.flakeguard/history.json` | Rolling JSON history snapshot. |
| `max_runs` | `10` | Maximum recent runs to retain per test. |
| `suspect_threshold` | `2` | Minimum failures in the rolling window before a mixed pass/fail test becomes a suspect flake. |

## Outputs

| Output | Description |
| --- | --- |
| `suspect_count` | Number of likely flaky tests detected. |
| `summary_path` | Path to the generated markdown summary file. |
| `history_path` | Path to the updated JSON history file. |

## History persistence

For this MVP, FlakeGuard only updates a local JSON file. To make the wedge useful across workflow runs, persist that file between runs later with artifacts, a cache key, or a branch-backed automation step.

## Local demo

```bash
npm install
INPUT_REPORT_PATHS=fixtures/junit-sample.xml \
INPUT_HISTORY_FILE=.flakeguard/demo-history.json \
INPUT_MAX_RUNS=5 \
INPUT_SUSPECT_THRESHOLD=2 \
node dist/index.js
```

That command writes a summary markdown file next to the history file and updates the JSON snapshot for the next run.
