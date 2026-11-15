import type { CompletionRequest, CompletionResult, LLMProvider } from './provider';

export interface AnthropicOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  /** Injected for tests. */
  fetchImpl?: typeof fetch;
  maxRetries?: number;
}

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504, 529]);

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: AnthropicOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const base = this.opts.baseUrl ?? process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com';
    const url = `${base.replace(/\/+$/, '')}/v1/messages`;
    const maxRetries = this.opts.maxRetries ?? 3;
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const res = await this.fetchImpl(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': this.opts.apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: this.opts.model,
            max_tokens: req.maxTokens,
            system: req.system,
            messages: req.messages,
          }),
        });

        if (!res.ok) {
          const body = await res.text().catch(() => '');
          const err = new Error(`Anthropic API ${res.status}: ${body.slice(0, 300)}`);
          if (RETRYABLE.has(res.status) && attempt < maxRetries) {
            lastError = err;
            await sleep(backoffMs(attempt));
            continue;
          }
          throw err;
        }

        const data = (await res.json()) as {
          content?: { type: string; text?: string }[];
          usage?: { input_tokens?: number; output_tokens?: number };
        };
        const text = (data.content ?? [])
          .filter((b) => b.type === 'text' && typeof b.text === 'string')
          .map((b) => b.text)
          .join('');
        return {
          text,
          usage: {
            inputTokens: data.usage?.input_tokens ?? 0,
            outputTokens: data.usage?.output_tokens ?? 0,
          },
        };
      } catch (e) {
        lastError = e;
        const isHttpError = e instanceof Error && e.message.startsWith('Anthropic API');
        if (isHttpError || attempt >= maxRetries) throw e;
        await sleep(backoffMs(attempt)); // network error: retry
      }
    }
    throw lastError;
  }
}

function backoffMs(attempt: number): number {
  return Math.min(8000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250);
}
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
