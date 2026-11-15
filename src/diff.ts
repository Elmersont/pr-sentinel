import { matchesAny } from './glob';

export interface FileDiff {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  binary: boolean;
  additions: number;
  deletions: number;
  /** New-file line numbers of every added line, mapped to its text. Used to ground findings. */
  addedLines: Map<number, string>;
  /** New-file line numbers visible in the diff (added + context). */
  visibleLines: Set<number>;
  /** Patch rendered with explicit new-file line numbers so the model can cite them. */
  annotated: string;
}

const HUNK_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** Parses a unified diff (as produced by `git diff` / GitHub's diff media type). */
export function parseUnifiedDiff(diff: string): FileDiff[] {
  const chunks = diff.split(/^diff --git /m).filter((c) => c.trim().length > 0);
  const files: FileDiff[] = [];

  for (const chunk of chunks) {
    const lines = chunk.split('\n');
    const header = lines[0] ?? '';
    const m = header.match(/^a\/(.+?) b\/(.+)$/);
    let path = m ? m[2] : header.trim();
    let status: FileDiff['status'] = 'modified';
    let binary = false;

    const file: FileDiff = {
      path,
      status,
      binary,
      additions: 0,
      deletions: 0,
      addedLines: new Map(),
      visibleLines: new Set(),
      annotated: '',
    };

    const out: string[] = [];
    let newLine = 0;
    let inHunk = false;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!inHunk) {
        if (line.startsWith('new file mode')) status = 'added';
        else if (line.startsWith('deleted file mode')) status = 'deleted';
        else if (line.startsWith('rename to ')) {
          status = 'renamed';
          path = line.slice('rename to '.length).trim();
        } else if (line.startsWith('Binary files') || line.startsWith('GIT binary patch')) {
          binary = true;
        } else if (line.startsWith('+++ ')) {
          const p = line.slice(4).trim();
          if (p !== '/dev/null') path = p.replace(/^b\//, '');
        }
      }
      const h = line.match(HUNK_RE);
      if (h) {
        inHunk = true;
        newLine = parseInt(h[1], 10);
        out.push(line);
        continue;
      }
      if (!inHunk) continue;
      if (line.startsWith('\\')) continue; // "\ No newline at end of file"

      if (line.startsWith('+')) {
        file.additions++;
        file.addedLines.set(newLine, line.slice(1));
        file.visibleLines.add(newLine);
        out.push(`L${newLine} | ${line}`);
        newLine++;
      } else if (line.startsWith('-')) {
        file.deletions++;
        out.push(`     | ${line}`);
      } else if (line.length > 0 || i < lines.length - 1) {
        file.visibleLines.add(newLine);
        out.push(`L${newLine} | ${line}`);
        newLine++;
      }
    }

    file.path = path;
    file.status = status;
    file.binary = binary;
    file.annotated = out.join('\n');
    files.push(file);
  }
  return files;
}

export interface SelectedDiff {
  included: FileDiff[];
  skipped: { path: string; reason: 'ignored' | 'binary' | 'deleted' | 'budget' | 'too-large' }[];
  text: string;
  chars: number;
}

export interface SelectOptions {
  ignore: string[];
  maxDiffChars: number;
  maxFileChars: number;
}

/** Filters ignored/binary files and packs the rest into a character budget. */
export function selectForReview(files: FileDiff[], opts: SelectOptions): SelectedDiff {
  const included: FileDiff[] = [];
  const skipped: SelectedDiff['skipped'] = [];
  const parts: string[] = [];
  let used = 0;

  for (const f of files) {
    if (matchesAny(f.path, opts.ignore)) {
      skipped.push({ path: f.path, reason: 'ignored' });
      continue;
    }
    if (f.binary) {
      skipped.push({ path: f.path, reason: 'binary' });
      continue;
    }
    if (f.status === 'deleted') {
      skipped.push({ path: f.path, reason: 'deleted' });
      continue;
    }
    if (f.annotated.length > opts.maxFileChars) {
      skipped.push({ path: f.path, reason: 'too-large' });
      continue;
    }
    const block = `### FILE: ${f.path} (${f.status})\n${f.annotated}\n`;
    if (used + block.length > opts.maxDiffChars) {
      skipped.push({ path: f.path, reason: 'budget' });
      continue;
    }
    parts.push(block);
    used += block.length;
    included.push(f);
  }
  return { included, skipped, text: parts.join('\n'), chars: used };
}
