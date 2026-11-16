/**
 * End-to-end test of the BUNDLED action (dist/index.js) against local fake servers for
 * GitHub, Anthropic, Jira and Teams/Slack. No network, no secrets. Run: npm run build && npm run e2e
 */
import assert from 'assert';
import { spawn } from 'child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import http from 'http';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

const ROOT = resolve(__dirname, '..');
const DIFF = readFileSync(join(ROOT, 'evals/cases/01-sql-injection.diff'), 'utf8');

interface Hit { method: string; url: string; body: string }
const hits: Hit[] = [];
const comments: { id: number; body: string }[] = [];
let jiraCount = 0;

const MODEL_REPLY = JSON.stringify({
  summary: 'Adds a name search that builds SQL by string concatenation.',
  risk: 'high',
  labels: ['security'],
  findings: [
    { severity: 'high', category: 'security', file: 'src/users/repo.ts', line: 17, title: 'SQL injection in searchByName', explanation: 'name is interpolated into the query.', suggestion: 'Use a parameterised query: db.query("... LIKE $1", [`%${name}%`])' },
    { severity: 'medium', category: 'maintainability', file: 'src/users/repo.ts', line: 999, title: 'Hallucinated line number', explanation: 'cites a line that is not in the diff.', suggestion: null },
    { severity: 'high', category: 'bug', file: 'src/does/not-exist.ts', line: 3, title: 'Finding in a file that is not in the PR', explanation: 'should be discarded.', suggestion: null },
  ],
});

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b)); });
}
function json(res: http.ServerResponse, code: number, data: unknown) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  const body = await readBody(req);
  const url = req.url ?? '';
  hits.push({ method: req.method ?? '', url, body });

  if (req.method === 'GET' && url === '/repos/o/r/pulls/7') {
    res.writeHead(200, { 'content-type': 'application/vnd.github.v3.diff; charset=utf-8' });
    return res.end(DIFF);
  }
  if (req.method === 'GET' && url.startsWith('/repos/o/r/issues/7/comments')) return json(res, 200, comments);
  if (req.method === 'POST' && url === '/repos/o/r/issues/7/comments') {
    const c = { id: comments.length + 1, body: JSON.parse(body).body };
    comments.push(c);
    return json(res, 201, c);
  }
  const patch = url.match(/^\/repos\/o\/r\/issues\/comments\/(\d+)$/);
  if (req.method === 'PATCH' && patch) {
    const c = comments.find((x) => x.id === Number(patch[1]));
    if (!c) return json(res, 404, {});
    c.body = JSON.parse(body).body;
    return json(res, 200, c);
  }
  if (req.method === 'POST' && url === '/repos/o/r/pulls/7/reviews') return json(res, 200, { id: 1 });
  if (req.method === 'POST' && url === '/v1/messages') {
    return json(res, 200, { content: [{ type: 'text', text: '```json\n' + MODEL_REPLY + '\n```' }], usage: { input_tokens: 1200, output_tokens: 300 } });
  }
  if (req.method === 'POST' && url === '/openai/chat/completions') {
    return json(res, 200, { choices: [{ message: { content: MODEL_REPLY } }], usage: { prompt_tokens: 900, completion_tokens: 100 } });
  }
  if (req.method === 'POST' && url === '/rest/api/2/issue') return json(res, 201, { key: `ENG-${++jiraCount}` });
  if (req.method === 'POST' && (url === '/hook/teams' || url === '/hook/slack')) return json(res, 200, {});
  json(res, 404, { error: `unhandled ${req.method} ${url}` });
});

function runAction(env: NodeJS.ProcessEnv, cwd: string): Promise<{ code: number | null; out: string }> {
  return new Promise((done) => {
    const child = spawn('node', [join(ROOT, 'dist/index.js')], { env, cwd });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => done({ code, out }));
  });
}

/** GITHUB_OUTPUT must point at an existing file, like on a real runner. */
function outFile(dir: string, name: string): string {
  const p = join(dir, name);
  writeFileSync(p, '');
  return p;
}

const count = (method: string, url: string) => hits.filter((h) => h.method === method && h.url === url).length;

async function main() {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const dir = mkdtempSync(join(tmpdir(), 'ps-e2e-'));
  const event = join(dir, 'event.json');
  writeFileSync(event, JSON.stringify({ pull_request: { number: 7, title: 'Add name search', body: 'search users', html_url: 'https://github.com/o/r/pull/7' } }));
  writeFileSync(join(dir, '.ai-review.yml'), [
    'fail_on: high', 'inline_comments: true', 'pricing:', '  input_per_mtok: 3', '  output_per_mtok: 15',
    'integrations:', '  jira:', '    enabled: true', '    project_key: ENG', '  teams:', '    enabled: true', '  slack:', '    enabled: true',
  ].join('\n'));

  const baseEnv: NodeJS.ProcessEnv = {
    PATH: process.env.PATH, HOME: process.env.HOME,
    GITHUB_EVENT_PATH: event, GITHUB_EVENT_NAME: 'pull_request', GITHUB_REPOSITORY: 'o/r', GITHUB_API_URL: base,
    ANTHROPIC_BASE_URL: base,
    'INPUT_ANTHROPIC_API_KEY': 'test-key', 'INPUT_GITHUB_TOKEN': 'test-token', 'INPUT_CONFIG_PATH': '.ai-review.yml',
    'INPUT_JIRA_BASE_URL': base, 'INPUT_JIRA_EMAIL': 'a@b.c', 'INPUT_JIRA_API_TOKEN': 'jt',
    'INPUT_TEAMS_WEBHOOK_URL': `${base}/hook/teams`, 'INPUT_SLACK_WEBHOOK_URL': `${base}/hook/slack`,
  };

  // ---- Run 1
  const out1 = outFile(dir, 'out1.txt');
  const r1 = await runAction({ ...baseEnv, GITHUB_OUTPUT: out1 }, dir);
  assert.strictEqual(r1.code, 1, `run 1 should fail the check (fail_on: high). Output:\n${r1.out}`);
  assert.match(r1.out, /1 finding\(s\) at or above "high"/);
  assert.strictEqual(comments.length, 1, 'one sticky comment created');
  const c1 = comments[0].body;
  assert.match(c1, /SQL injection in searchByName/);
  assert.match(c1, /`src\/users\/repo\.ts:17`/);
  assert.match(c1, /Hallucinated line number/);           // kept, but at file level
  assert.doesNotMatch(c1, /src\/users\/repo\.ts:999/);    // bad line stripped
  assert.doesNotMatch(c1, /not-exist/);                   // ungrounded file dropped
  assert.match(c1, /1 ungrounded finding\(s\) discarded/);
  assert.match(c1, /ENG-1/);
  assert.match(c1, /~\$0\.0081/);                         // 1200*3/1e6 + 300*15/1e6
  assert.strictEqual(jiraCount, 1, 'Jira: only the high-severity finding becomes a ticket');
  assert.strictEqual(count('POST', '/hook/teams'), 1);
  assert.strictEqual(count('POST', '/hook/slack'), 1);
  const review = hits.find((h) => h.url === '/repos/o/r/pulls/7/reviews');
  assert.ok(review, 'inline review posted');
  assert.strictEqual(JSON.parse(review.body).comments.length, 1, 'only the grounded line-level finding is inlined');
  const outputs = readFileSync(out1, 'utf8');
  const out = (name: string) => outputs.match(new RegExp(`${name}<<(\\S+)\\n([\\s\\S]*?)\\n\\1`))?.[2];
  assert.strictEqual(out('risk'), 'high');
  assert.strictEqual(out('findings_count'), '2');
  assert.strictEqual(out('tokens'), '1500');
  assert.strictEqual(out('cost_usd'), '0.0081');

  // ---- Run 2 (same PR, e.g. another push): must update in place and not duplicate side effects
  const r2 = await runAction({ ...baseEnv, GITHUB_OUTPUT: outFile(dir, 'out2.txt') }, dir);
  assert.strictEqual(r2.code, 1);
  assert.doesNotMatch(r2.out, /::error::(?!1 finding)/, 'run 2 must fail only because of fail_on');
  assert.strictEqual(comments.length, 1, 'still one comment (updated in place)');
  assert.strictEqual(count('PATCH', '/repos/o/r/issues/comments/1'), 1);
  assert.strictEqual(jiraCount, 1, 'Jira ticket not duplicated');
  assert.strictEqual(count('POST', '/repos/o/r/pulls/7/reviews'), 1, 'inline comment not duplicated');
  assert.match(comments[0].body, /<!-- ps:created:[a-f0-9]+ -->/);

  // ---- Run 3: no API key (fork PR) -> skip quietly, exit 0, no model call
  const before = count('POST', '/v1/messages');
  const r3 = await runAction({ ...baseEnv, INPUT_ANTHROPIC_API_KEY: '', GITHUB_OUTPUT: outFile(dir, 'out3.txt') }, dir);
  assert.strictEqual(r3.code, 0);
  assert.match(r3.out, /Skipping review/);
  assert.strictEqual(count('POST', '/v1/messages'), before);

  // ---- Run 4: free-provider path (provider: openai-compatible) selected purely by config + llm_api_key
  writeFileSync(join(dir, 'free.yml'), [
    'provider: openai-compatible', `base_url: ${base}/openai/`, 'model: gemini-test', 'reasoning_effort: low',
    'integrations:', '  jira:', '    enabled: true', '    project_key: ENG',
  ].join('\n'));
  const oaBefore = count('POST', '/openai/chat/completions');
  const r4 = await runAction(
    { ...baseEnv, INPUT_ANTHROPIC_API_KEY: '', INPUT_LLM_API_KEY: 'free-key', INPUT_CONFIG_PATH: 'free.yml', GITHUB_OUTPUT: outFile(dir, 'out4.txt') },
    dir,
  );
  assert.strictEqual(r4.code, 0, `run 4 should pass (no fail_on). Output:\n${r4.out}`);
  assert.strictEqual(count('POST', '/openai/chat/completions'), oaBefore + 1, 'OpenAI-compatible endpoint was called');
  const oaCall = hits.filter((h) => h.url === '/openai/chat/completions').at(-1) as Hit;
  const oaBody = JSON.parse(oaCall.body);
  assert.strictEqual(oaBody.model, 'gemini-test');
  assert.strictEqual(oaBody.reasoning_effort, 'low');
  assert.strictEqual(oaBody.messages[0].role, 'system');
  assert.strictEqual(count('POST', '/v1/messages'), before, 'Anthropic endpoint untouched in run 4');
  assert.strictEqual(jiraCount, 1, 'Jira still idempotent with the new provider');
  assert.match(comments[0].body, /1000 tokens/);

  console.log('e2e: all assertions passed (4 runs: create, idempotent update, fork-PR skip, free-provider path)');
  console.log('\n----- sticky comment as posted -----\n' + comments[0].body);
  server.close();
}

main().catch((e) => { console.error(e); server.close(); process.exit(1); });
