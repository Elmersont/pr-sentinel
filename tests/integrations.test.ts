import { createJiraIssues } from '../src/integrations/jira';
import { postWebhook, shouldNotify, slackPayload, teamsPayload } from '../src/integrations/chat';
import { parseConfig } from '../src/config';
import { fingerprint, runReview } from '../src/review';
import type { Finding } from '../src/schema';
import { finding, reviewJson, SAMPLE_DIFF, scripted } from './helpers';

const pr = { repo: 'o/r', number: 7, url: 'https://github.com/o/r/pull/7', title: 'Fix stuff' };
const jiraCfg = { baseUrl: 'https://x.atlassian.net/', email: 'a@b.c', apiToken: 'tok', projectKey: 'ENG', issueType: 'Task', labels: ['pr-sentinel'] };

function fakeFetch(responses: { ok: boolean; status?: number; json?: unknown; text?: string }[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  let i = 0;
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = responses[Math.min(i++, responses.length - 1)];
    return { ok: r.ok, status: r.status ?? (r.ok ? 200 : 500), json: async () => r.json, text: async () => r.text ?? '' };
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('createJiraIssues', () => {
  const f1 = finding({ title: 'First problem here' }) as Finding;
  const f2 = finding({ title: 'Second problem here', severity: 'critical' }) as Finding;

  it('posts one issue per finding with Basic auth and PR link', async () => {
    const { fn, calls } = fakeFetch([{ ok: true, json: { key: 'ENG-1' } }, { ok: true, json: { key: 'ENG-2' } }]);
    const r = await createJiraIssues(jiraCfg, [f1, f2], pr, new Set(), fn);
    expect(r.created.map((c) => c.key)).toEqual(['ENG-1', 'ENG-2']);
    expect(calls[0].url).toBe('https://x.atlassian.net/rest/api/2/issue');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Basic ' + Buffer.from('a@b.c:tok').toString('base64'));
    const body = JSON.parse(calls[1].init.body as string);
    expect(body.fields.summary).toBe('[CRITICAL] Second problem here');
    expect(body.fields.project.key).toBe('ENG');
    expect(body.fields.description).toContain(pr.url);
  });

  it('is idempotent: skips fingerprints created on a previous run', async () => {
    const { fn, calls } = fakeFetch([{ ok: true, json: { key: 'ENG-9' } }]);
    const r = await createJiraIssues(jiraCfg, [f1, f2], pr, new Set([fingerprint(f1)]), fn);
    expect(r.skipped).toEqual([fingerprint(f1)]);
    expect(r.created).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  it('reports a failure without aborting the remaining findings', async () => {
    const { fn } = fakeFetch([{ ok: false, status: 400, text: 'bad project' }, { ok: true, json: { key: 'ENG-3' } }]);
    const r = await createJiraIssues(jiraCfg, [f1, f2], pr, new Set(), fn);
    expect(r.errors[0].message).toMatch(/Jira 400: bad project/);
    expect(r.created.map((c) => c.key)).toEqual(['ENG-3']);
  });
});

describe('chat notifications', () => {
  it('shouldNotify respects the risk threshold', () => {
    expect(shouldNotify('high', 'high')).toBe(true);
    expect(shouldNotify('medium', 'high')).toBe(false);
    expect(shouldNotify('low', 'low')).toBe(true);
  });

  it('builds Teams adaptive-card and Slack payloads', async () => {
    const r = await runReview({ title: 't', body: '', diff: SAMPLE_DIFF }, parseConfig(undefined), scripted([reviewJson([finding()])]));
    const teams = teamsPayload(r, pr);
    expect(teams.attachments[0].contentType).toBe('application/vnd.microsoft.card.adaptive');
    expect(JSON.stringify(teams)).toContain('o/r#7');
    expect(teams.attachments[0].content.actions[0].url).toBe(pr.url);
    expect(slackPayload(r, pr).text).toContain('Division by zero');
  });

  it('postWebhook throws on non-2xx', async () => {
    const { fn } = fakeFetch([{ ok: false, status: 404 }]);
    await expect(postWebhook('https://hook', {}, fn)).rejects.toThrow(/404/);
  });
});
