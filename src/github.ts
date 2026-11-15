import type { getOctokit } from '@actions/github';
import { formatFinding, MARKER } from './format';
import type { Finding } from './schema';

export type Octokit = ReturnType<typeof getOctokit>;

export interface PrTarget {
  owner: string;
  repo: string;
  number: number;
}

export async function getPrDiff(octokit: Octokit, t: PrTarget): Promise<string> {
  const res = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
    owner: t.owner,
    repo: t.repo,
    pull_number: t.number,
    headers: { accept: 'application/vnd.github.v3.diff' },
  });
  return res.data as unknown as string;
}

export async function findStickyComment(
  octokit: Octokit,
  t: PrTarget,
): Promise<{ id: number; body: string } | undefined> {
  const comments = await octokit.paginate(octokit.rest.issues.listComments, {
    owner: t.owner,
    repo: t.repo,
    issue_number: t.number,
    per_page: 100,
  });
  const hit = comments.find((c) => c.body?.includes(MARKER));
  return hit ? { id: hit.id, body: hit.body ?? '' } : undefined;
}

/** One comment per PR, edited in place on every push. */
export async function upsertComment(
  octokit: Octokit,
  t: PrTarget,
  body: string,
  existingId?: number,
): Promise<void> {
  if (existingId) {
    await octokit.rest.issues.updateComment({ owner: t.owner, repo: t.repo, comment_id: existingId, body });
  } else {
    await octokit.rest.issues.createComment({ owner: t.owner, repo: t.repo, issue_number: t.number, body });
  }
}

/** Line-anchored comments. Only grounded findings (with a line) are sent. */
export async function postInlineReview(
  octokit: Octokit,
  t: PrTarget,
  findings: Finding[],
): Promise<number> {
  const comments = findings
    .filter((f) => f.line !== null)
    .map((f) => ({ path: f.file, line: f.line as number, side: 'RIGHT' as const, body: formatFinding(f) }));
  if (comments.length === 0) return 0;
  await octokit.rest.pulls.createReview({
    owner: t.owner,
    repo: t.repo,
    pull_number: t.number,
    event: 'COMMENT',
    comments,
  });
  return comments.length;
}
