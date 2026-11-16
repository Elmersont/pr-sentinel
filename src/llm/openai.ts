import { postJson } from './http';
import type { CompletionRequest, CompletionResult, LLMProvider } from './provider';

export interface OpenAICompatibleOptions {
  apiKey: string;
  model: string;
  /** e.g. https://generativelanguage.googleapis.com/v1beta/openai/ or http://localhost:11434/v1 */
  baseUrl: string;
  /** Forwarded as `reasoning_effort` when set (useful to keep "thinking" models from eating the output budget). */
  reasoningEffort?: string;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
}

interface ChatResponse {
  choices?: { message?: { content?: string | { type?: string; text?: string }[] | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** Talks to any server exposing POST {baseUrl}/chat/completions (Gemini API, Ollama, OpenRouter, vLLM, ...). */
export class OpenAICompatibleProvider implements LLMProvider {
  readonly name = 'openai-compatible';

  constructor(private readonly opts: OpenAICompatibleOptions) {}

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const body: Record<string, unknown> = {
      model: this.opts.model,
      max_tokens: req.maxTokens,
      messages: [{ role: 'system', content: req.system }, ...req.messages],
    };
    if (this.opts.reasoningEffort) body.reasoning_effort = this.opts.reasoningEffort;

    const data = await postJson<ChatResponse>(
      `${this.opts.baseUrl.replace(/\/+$/, '')}/chat/completions`,
      { 'content-type': 'application/json', authorization: `Bearer ${this.opts.apiKey}` },
      body,
      { label: 'OpenAI-compatible', fetchImpl: this.opts.fetchImpl ?? fetch, maxRetries: this.opts.maxRetries ?? 3 },
    );

    const content = data.choices?.[0]?.message?.content;
    const text = Array.isArray(content)
      ? content.map((p) => p.text ?? '').join('')
      : typeof content === 'string'
        ? content
        : '';
    return {
      text,
      usage: { inputTokens: data.usage?.prompt_tokens ?? 0, outputTokens: data.usage?.completion_tokens ?? 0 },
    };
  }
}
