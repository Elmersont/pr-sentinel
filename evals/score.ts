import type { Finding } from '../src/schema';
import { severityRank } from '../src/schema';

export interface ExpectedIssue {
  file: string;
  /** Any of these categories counts as a hit (models label the same bug differently). */
  categories: string[];
  /** Inclusive line range in the new file. */
  lines: [number, number];
}

export interface EvalCase {
  id: string;
  description: string;
  clean: boolean;
  expected: ExpectedIssue[];
}

export interface CaseScore {
  id: string;
  expected: number;
  matched: number;
  /** Findings of severity >= medium that matched no expected issue. */
  falsePositives: number;
  clean: boolean;
}

const LINE_TOLERANCE = 2;

export function matches(f: Finding, e: ExpectedIssue): boolean {
  if (f.file !== e.file) return false;
  if (!e.categories.includes(f.category)) return false;
  // A file-level finding (line === null) is accepted: the model found the right problem in the right file.
  if (f.line === null) return true;
  return f.line >= e.lines[0] - LINE_TOLERANCE && f.line <= e.lines[1] + LINE_TOLERANCE;
}

export function scoreCase(c: EvalCase, findings: Finding[]): CaseScore {
  const matchedExpected = c.expected.filter((e) => findings.some((f) => matches(f, e))).length;
  const fp = findings.filter(
    (f) => severityRank(f.severity) >= severityRank('medium') && !c.expected.some((e) => matches(f, e)),
  ).length;
  return { id: c.id, expected: c.expected.length, matched: matchedExpected, falsePositives: fp, clean: c.clean };
}

export interface Summary {
  recall: number;
  falsePositives: number;
  cleanCasesPassed: number;
  cleanCases: number;
  cases: number;
}

export function summarize(scores: CaseScore[]): Summary {
  const expected = scores.reduce((s, c) => s + c.expected, 0);
  const matched = scores.reduce((s, c) => s + c.matched, 0);
  const clean = scores.filter((c) => c.clean);
  return {
    recall: expected === 0 ? 1 : matched / expected,
    falsePositives: scores.reduce((s, c) => s + c.falsePositives, 0),
    cleanCases: clean.length,
    cleanCasesPassed: clean.filter((c) => c.falsePositives === 0).length,
    cases: scores.length,
  };
}
