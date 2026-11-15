import { parseUnifiedDiff, selectForReview } from '../src/diff';
import { SAMPLE_DIFF } from './helpers';

describe('parseUnifiedDiff', () => {
  it('tracks new-file line numbers for added and context lines', () => {
    const [f] = parseUnifiedDiff(SAMPLE_DIFF);
    expect(f.path).toBe('src/a.ts');
    expect(f.additions).toBe(2);
    expect(f.deletions).toBe(1);
    expect([...f.addedLines.keys()]).toEqual([11, 12]);
    expect(f.visibleLines.has(10)).toBe(true); // context line
    expect(f.visibleLines.has(13)).toBe(true);
    expect(f.annotated).toContain('L12 | +  const c = a / (b - 3);');
    expect(f.annotated).toContain('     | -  const b = 2;'); // removed lines carry no number
  });

  it('handles new, deleted, renamed and binary files', () => {
    const diff = [
      'diff --git a/n.ts b/n.ts', 'new file mode 100644', '--- /dev/null', '+++ b/n.ts', '@@ -0,0 +1,2 @@', '+a', '+b',
      'diff --git a/d.ts b/d.ts', 'deleted file mode 100644', '--- a/d.ts', '+++ /dev/null', '@@ -1,1 +0,0 @@', '-gone',
      'diff --git a/old.ts b/new.ts', 'similarity index 90%', 'rename from old.ts', 'rename to new.ts',
      'diff --git a/i.png b/i.png', 'Binary files a/i.png and b/i.png differ',
    ].join('\n');
    const files = parseUnifiedDiff(diff);
    expect(files.map((f) => [f.path, f.status, f.binary])).toEqual([
      ['n.ts', 'added', false],
      ['d.ts', 'deleted', false],
      ['new.ts', 'renamed', false],
      ['i.png', 'modified', true],
    ]);
    expect(files[0].addedLines.get(2)).toBe('b');
  });

  it('ignores the "No newline at end of file" marker', () => {
    const diff = 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,1 +1,1 @@\n-a\n\\ No newline at end of file\n+b\n\\ No newline at end of file\n';
    const [f] = parseUnifiedDiff(diff);
    expect(f.addedLines.get(1)).toBe('b');
    expect(f.annotated).not.toContain('No newline');
  });
});

describe('selectForReview', () => {
  const mk = (path: string, size = 10) =>
    `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1,1 +1,1 @@\n+${'x'.repeat(size)}\n`;
  const opts = { ignore: ['**/*.lock', 'dist/**'], maxDiffChars: 400, maxFileChars: 200 };

  it('skips ignored, binary, deleted, oversized and over-budget files with a reason', () => {
    const diff = [
      mk('a.ts'), mk('yarn.lock'), mk('dist/out.js'), mk('huge.ts', 500),
      'diff --git a/p.png b/p.png\nBinary files a/p.png and b/p.png differ\n',
      'diff --git a/d.ts b/d.ts\ndeleted file mode 100644\n--- a/d.ts\n+++ /dev/null\n@@ -1,1 +0,0 @@\n-x\n',
    ].join('');
    const sel = selectForReview(parseUnifiedDiff(diff), opts);
    expect(sel.included.map((f) => f.path)).toEqual(['a.ts']);
    expect(Object.fromEntries(sel.skipped.map((s) => [s.path, s.reason]))).toEqual({
      'yarn.lock': 'ignored', 'dist/out.js': 'ignored', 'huge.ts': 'too-large', 'p.png': 'binary', 'd.ts': 'deleted',
    });
  });

  it('stops adding files once the character budget is exhausted', () => {
    const diff = [mk('a.ts', 120), mk('b.ts', 120), mk('c.ts', 120), mk('d.ts', 120)].join('');
    const sel = selectForReview(parseUnifiedDiff(diff), { ...opts, maxDiffChars: 350 });
    expect(sel.included.length).toBeLessThan(4);
    expect(sel.skipped.some((s) => s.reason === 'budget')).toBe(true);
    expect(sel.chars).toBeLessThanOrEqual(350);
  });
});
