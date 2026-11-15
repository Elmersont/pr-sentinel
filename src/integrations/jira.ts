import { fingerprint } from '../review';
import type { Finding } from '../schema';

export interface JiraConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
  projectKey: string;
  issueType: string;
  labels: string[];
}

export interface PrRef {
  repo: string;
  number: number;
  url: string;
  title: string;
}

export interface JiraResult {
  created: { fingerprint: string; key: string }[];
  skipped: string[];
  errors: { fingerprint: string; message: string }[];
}

function describe(f: Finding, pr: PrRef): string {
  return [
    `Found by PR Sentinel in ${pr.repo}#${pr.number}: ${pr.url}`,
    '',
    `Severity: ${f.severity} | Category: ${f.category}`,
    `Location: ${f.file}${f.line ? ':' + f.line : ''}`,
    '',
    f.explanation,
    f.suggestion ? `\nSuggested fix:\n${f.suggestion}` : '',
  ].join('\n');
}

/**
 * Creates one Jira issue per finding (REST v2, plain-text description).
 * `alreadyCreated` makes the run idempotent across pushes to the same PR.
 */
export async function createJiraIssues(
  cfg: JiraConfig,
  findings: Finding[],
  pr: PrRef,
  alreadyCreated: Set<string>,
  fetchImpl: typeof fetch = fetch,
): Promise<JiraResult> {
  const result: JiraResult = { created: [], skipped: [], errors: [] };
  const auth = Buffer.from(`${cfg.email}:${cfg.apiToken}`).toString('base64');
  const base = cfg.baseUrl.replace(/\/+$/, '');

  for (const f of findings) {
    const fp = fingerprint(f);
    if (alreadyCreated.has(fp)) {
      result.skipped.push(fp);
      continue;
    }
    try {
      const res = await fetchImpl(`${base}/rest/api/2/issue`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Basic ${auth}` },
        body: JSON.stringify({
          fields: {
            project: { key: cfg.projectKey },
            summary: `[${f.severity.toUpperCase()}] ${f.title}`.slice(0, 250),
            issuetype: { name: cfg.issueType },
            labels: cfg.labels,
            description: describe(f, pr),
          },
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Jira ${res.status}: ${text.slice(0, 200)}`);
      }
      const data = (await res.json()) as { key: string };
      result.created.push({ fingerprint: fp, key: data.key });
    } catch (e) {
      result.errors.push({ fingerprint: fp, message: e instanceof Error ? e.message : String(e) });
    }
  }
  return result;
}
