import { postJson } from './http';
import type { CompletionRequest, CompletionResult, LLMProvider } from './provider';

export interface AnthropicOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  /** Injected for tests. */
  fetchImpl?: typeof fetch;
  maxRetries?: number;
}

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';

  constructor(private readonly opts: AnthropicOptions) {}

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const base = this.opts.baseUrl ?? process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com';
    const data = await postJson<{
      content?: { type: string; text?: string }[];
      usage?: { input_tokens?: number; output_tokens?: number };
    }>(
      `${base.replace(/\/+$/, '')}/v1/messages`,
      {
        'content-type': 'application/json',
        'x-api-key': this.opts.apiKey,
        'anthropic-version': '2023-06-01',
      },
      { model: this.opts.model, max_tokens: req.maxTokens, system: req.system, messages: req.messages },
      { label: 'Anthropic', fetchImpl: this.opts.fetchImpl ?? fetch, maxRetries: this.opts.maxRetries ?? 3 },
    );

    const text = (data.content ?? [])
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('');
    return {
      text,
      usage: { inputTokens: data.usage?.input_tokens ?? 0, outputTokens: data.usage?.output_tokens ?? 0 },
    };
  }
}
