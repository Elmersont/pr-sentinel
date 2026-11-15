export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface CompletionRequest {
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  maxTokens: number;
}

export interface CompletionResult {
  text: string;
  usage: Usage;
}

/** Any LLM backend implements this; the rest of the code never imports a vendor SDK. */
export interface LLMProvider {
  readonly name: string;
  complete(req: CompletionRequest): Promise<CompletionResult>;
}
