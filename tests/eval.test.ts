import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { parseUnifiedDiff } from '../src/diff';
import type { Finding } from '../src/schema';
import { EvalCase, matches, scoreCase, summarize } from '../evals/score';

const dir = join(__dirname, '..', 'evals', 'cases');
const cases: { c: EvalCase; diff: string }[] = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => ({ c: JSON.parse(readFileSync(join(dir, f), 'utf8')), diff: readFileSync(join(dir, f.replace('.json', '.diff')), 'utf8') }));

const f = (o: Partial<Finding> = {}): Finding => ({ severity: 'high', category: 'security', file: 'a.ts', line: 10, title: 'Something wrong', explanation: 'because', suggestion: null, ...o });

describe('eval dataset integrity', () => {
  it('has at least one clean and several buggy cases', () => {
    expect(cases.filter((x) => x.c.clean).length).toBeGreaterThanOrEqual(1);
    expect(cases.filter((x) => !x.c.clean).length).toBeGreaterThanOrEqual(5);
  });

  it.each(cases.map((x) => [x.c.id, x] as const))('%s: expected lines point at real added lines', (_id, { c, diff }) => {
    const files = parseUnifiedDiff(diff);
    for (const e of c.expected) {
      const file = files.find((x) => x.path === e.file);
      expect(file).toBeDefined();
      const hit = [...(file as NonNullable<typeof file>).addedLines.keys()].some((n) => n >= e.lines[0] && n <= e.lines[1]);
      expect(hit).toBe(true);
    }
    if (c.clean) expect(c.expected).toHaveLength(0);
  });
});

describe('scoring', () => {
  const exp = { file: 'a.ts', categories: ['security'], lines: [10, 12] as [number, number] };
  it('matches within tolerance, accepts file-level findings, rejects wrong file/category/line', () => {
    expect(matches(f({ line: 14 }), exp)).toBe(true);
    expect(matches(f({ line: 15 }), exp)).toBe(false);
    expect(matches(f({ line: null }), exp)).toBe(true);
    expect(matches(f({ file: 'b.ts' }), exp)).toBe(false);
    expect(matches(f({ category: 'style' }), exp)).toBe(false);
  });

  it('counts false positives only at medium severity or above', () => {
    const c: EvalCase = { id: 'x', description: '', clean: true, expected: [] };
    expect(scoreCase(c, [f({ severity: 'low' }), f({ severity: 'info' })]).falsePositives).toBe(0);
    expect(scoreCase(c, [f({ severity: 'medium' })]).falsePositives).toBe(1);
  });

  it('summarises recall and clean-case pass rate', () => {
    const s = summarize([
      { id: 'a', expected: 1, matched: 1, falsePositives: 0, clean: false },
      { id: 'b', expected: 1, matched: 0, falsePositives: 1, clean: false },
      { id: 'c', expected: 0, matched: 0, falsePositives: 0, clean: true },
      { id: 'd', expected: 0, matched: 0, falsePositives: 2, clean: true },
    ]);
    expect(s).toMatchObject({ recall: 0.5, falsePositives: 3, cleanCases: 2, cleanCasesPassed: 1, cases: 4 });
  });
});
