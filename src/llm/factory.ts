import type { Config } from '../config';
import { AnthropicProvider } from './anthropic';
import { OpenAICompatibleProvider } from './openai';
import type { LLMProvider } from './provider';

export function createProvider(cfg: Config, apiKey: string, overrides: { baseUrl?: string } = {}): LLMProvider {
  if (cfg.provider === 'openai-compatible') {
    const baseUrl = overrides.baseUrl || cfg.base_url;
    if (!baseUrl) {
      throw new Error('provider "openai-compatible" needs base_url (in .ai-review.yml or the llm_base_url input).');
    }
    return new OpenAICompatibleProvider({
      apiKey,
      model: cfg.model,
      baseUrl,
      reasoningEffort: cfg.reasoning_effort,
    });
  }
  return new AnthropicProvider({ apiKey, model: cfg.model });
}
