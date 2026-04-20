import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { globSync } from 'glob';
import { XMLParser } from 'fast-xml-parser';
import type { NormalizedTestCase, ParsedReport, RunTotals, TestStatus } from './types';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseTagValue: false,
  trimValues: true,
});

function ensureArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function resolveStatus(testCase: Record<string, unknown>): TestStatus {
  if ('failure' in testCase || 'error' in testCase) {
    return 'failed';
  }
  if ('skipped' in testCase) {
    return 'skipped';
  }
  return 'passed';
}

function collectTestCases(node: unknown): Record<string, unknown>[] {
  if (!isObject(node)) {
    return [];
  }

  const directCases = ensureArray(node.testcase).filter(isObject);
  const childSuites = ensureArray(node.testsuite).flatMap(collectTestCases);
  const nestedSuites = ensureArray(node.testsuites).flatMap(collectTestCases);

  return [...directCases, ...childSuites, ...nestedSuites];
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function resolveReportFiles(reportPathsInput: string, cwd = process.cwd()): Promise<string[]> {
  const patterns = reportPathsInput
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean);

  const resolvedFiles: string[] = [];

  for (const pattern of patterns) {
    const matches = globSync(pattern, {
      absolute: true,
      cwd,
      nodir: true,
    }).sort();

    if (matches.length > 0) {
      for (const match of matches) {
        if (!resolvedFiles.includes(match)) {
          resolvedFiles.push(match);
        }
      }
      continue;
    }

    const exactPath = path.resolve(cwd, pattern);
    if (await fileExists(exactPath) && !resolvedFiles.includes(exactPath)) {
      resolvedFiles.push(exactPath);
    }
  }

  if (resolvedFiles.length === 0) {
    throw new Error(`No JUnit reports matched: ${reportPathsInput}`);
  }

  return resolvedFiles;
}

export function calculateRunTotals(tests: NormalizedTestCase[]): RunTotals {
  return tests.reduce<RunTotals>(
    (totals, test) => {
      totals.total += 1;
      if (test.status === 'passed') {
        totals.passed += 1;
      } else if (test.status === 'failed') {
        totals.failed += 1;
      } else {
        totals.skipped += 1;
      }
      return totals;
    },
    { total: 0, passed: 0, failed: 0, skipped: 0 }
  );
}

function normalizeTestCase(testCase: Record<string, unknown>, sourceFile: string): NormalizedTestCase {
  const classname = String(testCase.classname ?? 'unknown.class');
  const name = String(testCase.name ?? 'unknown test');

  return {
    id: `${classname}::${name}`,
    classname,
    name,
    status: resolveStatus(testCase),
    sourceFile,
  };
}

export async function parseJUnitReports(reportPathsInput: string, cwd = process.cwd()): Promise<ParsedReport> {
  const sourceFiles = await resolveReportFiles(reportPathsInput, cwd);
  const tests: NormalizedTestCase[] = [];

  for (const sourceFile of sourceFiles) {
    const xml = await readFile(sourceFile, 'utf8');
    const parsed = xmlParser.parse(xml);
    const testCases = collectTestCases(parsed);
    tests.push(...testCases.map(testCase => normalizeTestCase(testCase, sourceFile)));
  }

  return {
    sourceFiles,
    tests,
    totals: calculateRunTotals(tests),
  };
}
