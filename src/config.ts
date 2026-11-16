import { z } from 'zod';
import { parse } from 'yaml';
import { SEVERITIES } from './schema';

export const DEFAULT_IGNORE = [
  '**/package-lock.json',
  '**/yarn.lock',
  '**/pnpm-lock.yaml',
  '**/*.lock',
  '**/dist/**',
  '**/build/**',
  '**/node_modules/**',
  '**/*.min.js',
  '**/*.min.css',
  '**/*.map',
  '**/*.snap',
  '**/*.svg',
  '**/*.png',
  '**/*.jpg',
  '**/*.jpeg',
  '**/*.gif',
  '**/*.pdf',
];

const Severity = z.enum(SEVERITIES);

export const ConfigSchema = z.object({
  /** "anthropic" (default) or any OpenAI-compatible server (Gemini API, Ollama, OpenRouter, ...). */
  provider: z.enum(['anthropic', 'openai-compatible']).default('anthropic'),
  /** Required for provider "openai-compatible", e.g. https://generativelanguage.googleapis.com/v1beta/openai/ */
  base_url: z.string().url().optional(),
  /** Passed as `reasoning_effort` to openai-compatible servers that support it. */
  reasoning_effort: z.enum(['none', 'minimal', 'low', 'medium', 'high']).optional(),
  model: z.string().default('claude-sonnet-5-5'),
  language: z.enum(['en', 'es']).default('en'),
  max_diff_chars: z.number().int().positive().default(60_000),
  max_file_chars: z.number().int().positive().default(20_000),
  max_findings: z.number().int().min(1).max(50).default(15),
  max_output_tokens: z.number().int().positive().default(4096),
  /** Findings below this severity are dropped from the report. */
  min_severity: Severity.default('low'),
  /** Fail the check when a finding at or above this severity exists. "none" never fails. */
  fail_on: z.enum(['none', ...SEVERITIES]).default('none'),
  /** Extra globs, added to the built-in ignore list. */
  ignore: z.array(z.string()).default([]),
  /** Post line-anchored review comments in addition to the summary comment. */
  inline_comments: z.boolean().default(false),
  /** Optional price table so the report can show an estimated cost. USD per million tokens. */
  pricing: z
    .object({ input_per_mtok: z.number().nonnegative(), output_per_mtok: z.number().nonnegative() })
    .optional(),
  integrations: z
    .object({
      jira: z
        .object({
          enabled: z.boolean().default(false),
          project_key: z.string().default(''),
          issue_type: z.string().default('Task'),
          min_severity: Severity.default('high'),
          labels: z.array(z.string()).default(['pr-sentinel']),
        })
        .default({}),
      teams: z
        .object({
          enabled: z.boolean().default(false),
          min_risk: z.enum(['low', 'medium', 'high']).default('high'),
        })
        .default({}),
      slack: z
        .object({
          enabled: z.boolean().default(false),
          min_risk: z.enum(['low', 'medium', 'high']).default('high'),
        })
        .default({}),
    })
    .default({}),
});

export type Config = z.infer<typeof ConfigSchema>;

export function parseConfig(yamlText: string | undefined): Config {
  const raw = yamlText && yamlText.trim() ? parse(yamlText) : {};
  const result = ConfigSchema.safeParse(raw ?? {});
  if (!result.success) {
    const msg = result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    throw new Error(`Invalid .ai-review.yml: ${msg}`);
  }
  const cfg = result.data;
  if (cfg.provider === 'openai-compatible') {
    const hasModel = typeof (raw as { model?: unknown } | null)?.model === 'string';
    if (!hasModel) throw new Error('Invalid .ai-review.yml: model: required when provider is "openai-compatible"');
  }
  return cfg;
}

export function effectiveIgnore(cfg: Config): string[] {
  return [...DEFAULT_IGNORE, ...cfg.ignore];
}
