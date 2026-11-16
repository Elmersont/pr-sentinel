import { parseConfig } from '../src/config';
import { createProvider } from '../src/llm/factory';
import { AnthropicProvider } from '../src/llm/anthropic';
import { OpenAICompatibleProvider } from '../src/llm/openai';

const req = { system: 'be brief', messages: [{ role: 'user' as const, content: 'hi' }], maxTokens: 77 };
const reply = (content: unknown, usage: object = { prompt_tokens: 11, completion_tokens: 4 }) => ({
  ok: true, status: 200, headers: new Headers(), json: async () => ({ choices: [{ message: { content } }], usage }), text: async () => '',
});
const err = (status: number, headers: Record<string, string> = {}) => ({
  ok: false, status, headers: new Headers(headers), json: async () => ({}), text: async () => 'nope',
});

function provider(seq: unknown[], extra: object = {}) {
  let i = 0;
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = seq[Math.min(i++, seq.length - 1)];
    if (r instanceof Error) throw r;
    return r;
  }) as unknown as typeof fetch;
  return { p: new OpenAICompatibleProvider({ apiKey: 'k', model: 'm', baseUrl: 'http://x/v1beta/openai/', fetchImpl, maxRetries: 2, ...extra }), calls };
}

describe('OpenAICompatibleProvider', () => {
  let delays: number[];
  beforeEach(() => {
    delays = [];
    jest.spyOn(global, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => { delays.push(ms ?? 0); fn(); return 0 as unknown as NodeJS.Timeout; }) as typeof setTimeout);
  });
  afterEach(() => jest.restoreAllMocks());

  it('posts to {base}/chat/completions with Bearer auth and the system prompt as first message', async () => {
    const { p, calls } = provider([reply('hello')]);
    const r = await p.complete(req);
    expect(r).toEqual({ text: 'hello', usage: { inputTokens: 11, outputTokens: 4 } });
    expect(calls[0].url).toBe('http://x/v1beta/openai/chat/completions');
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe('Bearer k');
    const body = JSON.parse(calls[0].init.body as string);
    expect(body.messages).toEqual([{ role: 'system', content: 'be brief' }, { role: 'user', content: 'hi' }]);
    expect(body).toMatchObject({ model: 'm', max_tokens: 77 });
    expect(body.reasoning_effort).toBeUndefined();
  });

  it('forwards reasoning_effort only when configured', async () => {
    const { p, calls } = provider([reply('x')], { reasoningEffort: 'low' });
    await p.complete(req);
    expect(JSON.parse(calls[0].init.body as string).reasoning_effort).toBe('low');
  });

  it('handles array content parts and missing content/usage', async () => {
    expect((await provider([reply([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }])]).p.complete(req)).text).toBe('ab');
    const empty = await provider([reply(null, {})]).p.complete(req);
    expect(empty).toEqual({ text: '', usage: { inputTokens: 0, outputTokens: 0 } });
  });

  it('honours Retry-After on 429 (in seconds) before retrying', async () => {
    const { p, calls } = provider([err(429, { 'retry-after': '7' }), reply('ok')]);
    expect((await p.complete(req)).text).toBe('ok');
    expect(calls).toHaveLength(2);
    expect(delays).toContain(7000);
  });

  it('caps absurd Retry-After values at 60s and gives up after maxRetries', async () => {
    const { p, calls } = provider([err(429, { 'retry-after': '9999' })]);
    await expect(p.complete(req)).rejects.toThrow(/OpenAI-compatible API 429/);
    expect(calls).toHaveLength(3);
    expect(Math.max(...delays)).toBe(60000);
  });

  it('does not retry auth errors', async () => {
    const { p, calls } = provider([err(401)]);
    await expect(p.complete(req)).rejects.toThrow(/401/);
    expect(calls).toHaveLength(1);
  });
});

describe('createProvider / config', () => {
  it('defaults to Anthropic', () => {
    expect(createProvider(parseConfig(undefined), 'k')).toBeInstanceOf(AnthropicProvider);
  });

  it('builds the OpenAI-compatible provider from config, with the input overriding base_url', () => {
    const cfg = parseConfig('provider: openai-compatible\nmodel: gemini-2.5-flash\nbase_url: http://a/v1\nreasoning_effort: low');
    expect(createProvider(cfg, 'k')).toBeInstanceOf(OpenAICompatibleProvider);
    expect(cfg.reasoning_effort).toBe('low');
  });

  it('requires base_url and an explicit model for openai-compatible', () => {
    expect(() => createProvider(parseConfig('provider: openai-compatible\nmodel: m'), 'k')).toThrow(/base_url/);
    expect(() => createProvider(parseConfig('provider: openai-compatible\nmodel: m'), 'k', { baseUrl: 'http://b/v1' })).not.toThrow();
    expect(() => parseConfig('provider: openai-compatible\nbase_url: http://a/v1')).toThrow(/model: required/);
  });

  it('rejects unknown providers and malformed base_url', () => {
    expect(() => parseConfig('provider: banana')).toThrow(/provider/);
    expect(() => parseConfig('provider: openai-compatible\nmodel: m\nbase_url: not a url')).toThrow(/base_url/);
  });

  it('every shipped example config is valid', () => {
    const { readdirSync, readFileSync } = require('fs') as typeof import('fs');
    const dir = `${__dirname}/../examples`;
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.yml'))) {
      expect(() => parseConfig(readFileSync(`${dir}/${f}`, 'utf8'))).not.toThrow();
    }
    expect(() => parseConfig(readFileSync(`${__dirname}/../.ai-review.yml`, 'utf8'))).not.toThrow();
  });
});
