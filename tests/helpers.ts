import type { CompletionRequest, CompletionResult, LLMProvider } from '../src/llm/provider';

/** Scripted provider: returns each reply in order and records every request. */
export function scripted(replies: (string | Error)[]): LLMProvider & { requests: CompletionRequest[] } {
  const requests: CompletionRequest[] = [];
  let i = 0;
  return {
    name: 'scripted',
    requests,
    async complete(req: CompletionRequest): Promise<CompletionResult> {
      requests.push(req);
      const r = replies[Math.min(i++, replies.length - 1)];
      if (r instanceof Error) throw r;
      return { text: r, usage: { inputTokens: 100, outputTokens: 20 } };
    },
  };
}

export const SAMPLE_DIFF = `diff --git a/src/a.ts b/src/a.ts
index 111..222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -10,3 +10,5 @@ function x() {
   const a = 1;
-  const b = 2;
+  const b = 3;
+  const c = a / (b - 3);
   return a + b;
`;

export function reviewJson(findings: unknown[], extra: object = {}): string {
  return JSON.stringify({ summary: 'Sample summary.', risk: 'medium', labels: [], findings, ...extra });
}

export const finding = (over: object = {}) => ({
  severity: 'high',
  category: 'bug',
  file: 'src/a.ts',
  line: 12,
  title: 'Division by zero',
  explanation: 'b - 3 is always zero here.',
  suggestion: null,
  ...over,
});
