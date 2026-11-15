import { AnthropicProvider } from '../src/llm/anthropic';

const req = { system: 'sys', messages: [{ role: 'user' as const, content: 'hi' }], maxTokens: 50 };
const ok = (text: string) => ({ ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text }], usage: { input_tokens: 5, output_tokens: 2 } }), text: async () => '' });
const fail = (status: number) => ({ ok: false, status, json: async () => ({}), text: async () => 'err' });

function provider(seq: unknown[], maxRetries = 2) {
  let i = 0;
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = seq[Math.min(i++, seq.length - 1)];
    if (r instanceof Error) throw r;
    return r;
  }) as unknown as typeof fetch;
  return { p: new AnthropicProvider({ apiKey: 'k', model: 'm', fetchImpl, maxRetries }), calls };
}

describe('AnthropicProvider', () => {
  beforeEach(() => jest.spyOn(global, 'setTimeout').mockImplementation(((fn: () => void) => { fn(); return 0 as unknown as NodeJS.Timeout; }) as typeof setTimeout));
  afterEach(() => jest.restoreAllMocks());

  it('sends the right request and parses text and usage', async () => {
    const { p, calls } = provider([ok('hello')]);
    const r = await p.complete(req);
    expect(r).toEqual({ text: 'hello', usage: { inputTokens: 5, outputTokens: 2 } });
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('k');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(JSON.parse(calls[0].init.body as string)).toMatchObject({ model: 'm', max_tokens: 50, system: 'sys' });
  });

  it('retries on 429/529 and on network errors, then succeeds', async () => {
    const { p, calls } = provider([fail(429), new Error('socket hang up'), ok('fine')], 3);
    expect((await p.complete(req)).text).toBe('fine');
    expect(calls).toHaveLength(3);
  });

  it('does not retry client errors such as 401', async () => {
    const { p, calls } = provider([fail(401)]);
    await expect(p.complete(req)).rejects.toThrow(/401/);
    expect(calls).toHaveLength(1);
  });

  it('gives up after maxRetries', async () => {
    const { p, calls } = provider([fail(503)], 2);
    await expect(p.complete(req)).rejects.toThrow(/503/);
    expect(calls).toHaveLength(3);
  });
});
