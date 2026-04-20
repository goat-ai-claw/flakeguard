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
        uses: goat-ai-claw/flakeguard@v1
        with:
          report_paths: 'reports/junit.xml'
          history_file: '.flakeguard/history.json'
          max_runs: '10'
          suspect_threshold: '2'
```

For local development inside this repo, replace `goat-ai-claw/flakeguard@v1` with `./`.

That minimal snippet proves the wiring. To detect real cross-run flakes, pair it with the cache-backed history pattern in [`examples/cache-history.yml`](examples/cache-history.yml).

## What the workflow summary looks like

After FlakeGuard has seen a few runs for the same test, the GitHub Actions step summary highlights mixed pass/fail history directly in the workflow UI:

```md
# FlakeGuard Summary

## Current run totals

- Total: 2
- Passed: 1
- Failed: 1
- Skipped: 0

## Suspect flakes

- `suite.Flake::toggles` — latest: **failed**, passes: 1, failures: 2, recent: F → P → F

## Stable failures

No stable failures detected.
```

You can reproduce that exact suspect-flake summary locally with:

```bash
npm install
npm run demo:cross-run
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

The lightest credible MVP path is a branch-scoped cache that restores `.flakeguard/history.json` before FlakeGuard runs and saves it again afterward. See [`examples/cache-history.yml`](examples/cache-history.yml) for a copy-paste workflow using `actions/cache/restore@v4` and `actions/cache/save@v4`.

That pattern keeps the UX lightweight:

- one stable `history_file` path inside the repo workspace
- one unique cache key per run attempt (`github.run_id` + `github.run_attempt`)
- one branch-scoped `restore-keys` prefix so the latest history is reused on the next run without committing state back to the repo

Because this pattern creates one immutable cache entry per run attempt, teams should pair it with normal cache-retention hygiene if they keep FlakeGuard history for a long time.

## Local demo

```bash
npm install
npm run demo:cross-run
```

That command rebuilds `dist/`, runs three synthetic workflow executions against the same history file, and writes a real suspect-flake summary under `demo-output/cross-run/`.
