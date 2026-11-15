import { createHash } from 'crypto';
import { Config, effectiveIgnore } from './config';
import { FileDiff, parseUnifiedDiff, selectForReview, SelectedDiff } from './diff';
import type { LLMProvider, Usage } from './llm/provider';
import { buildSystemPrompt, buildUserPrompt } from './prompt';
import { redactSecrets } from './redact';
import { extractJson, Finding, Review, ReviewSchema, severityRank } from './schema';

export interface ReviewInput {
  title: string;
  body: string;
  diff: string;
}

export interface ReviewResult {
  review: Review;
  /** Findings after grounding, severity filter and de-duplication. */
  findings: Finding[];
  dropped: { ungrounded: number; belowThreshold: number; duplicates: number };
  usage: Usage;
  calls: number;
  files: { reviewed: string[]; skipped: SelectedDiff['skipped'] };
  redactions: { count: number; kinds: string[] };
  /** True when the model was never called because nothing reviewable was in the diff. */
  empty: boolean;
}

/** Stable id for a finding that survives line shifts between pushes. */
export function fingerprint(f: Pick<Finding, 'file' | 'category' | 'title'>): string {
  const norm = `${f.file}|${f.category}|${f.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`;
  return createHash('sha1').update(norm).digest('hex').slice(0, 10);
}

/**
 * Anti-hallucination check. A finding may only cite a line that is actually visible in the diff
 * and a file that is actually part of the reviewed set. Out-of-diff line numbers are cleared
 * (the finding is kept as file-level); unknown files are dropped.
 */
export function groundFindings(
  findings: Finding[],
  files: FileDiff[],
): { kept: Finding[]; dropped: number } {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const kept: Finding[] = [];
  let dropped = 0;
  for (const f of findings) {
    const file = byPath.get(f.file);
    if (!file) {
      dropped++;
      continue;
    }
    if (f.line !== null && !file.visibleLines.has(f.line)) {
      kept.push({ ...f, line: null });
    } else {
      kept.push(f);
    }
  }
  return { kept, dropped };
}

export function dedupe(findings: Finding[]): { kept: Finding[]; dropped: number } {
  const seen = new Set<string>();
  const kept: Finding[] = [];
  for (const f of findings) {
    const key = `${fingerprint(f)}:${f.line ?? 'x'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(f);
  }
  return { kept, dropped: findings.length - kept.length };
}

export async function runReview(
  input: ReviewInput,
  cfg: Config,
  provider: LLMProvider,
): Promise<ReviewResult> {
  const parsed = parseUnifiedDiff(input.diff);
  const selected = selectForReview(parsed, {
    ignore: effectiveIgnore(cfg),
    maxDiffChars: cfg.max_diff_chars,
    maxFileChars: cfg.max_file_chars,
  });

  const redacted = redactSecrets(selected.text);
  const title = redactSecrets(input.title).text;
  const body = redactSecrets(input.body).text;

  const usage: Usage = { inputTokens: 0, outputTokens: 0 };
  const files = { reviewed: selected.included.map((f) => f.path), skipped: selected.skipped };
  const redactions = { count: redacted.count, kinds: redacted.kinds };

  if (selected.included.length === 0) {
    return {
      review: {
        summary: 'No reviewable changes (all files were ignored, binary, deleted or over the size budget).',
        risk: 'low',
        labels: [],
        findings: [],
      },
      findings: [],
      dropped: { ungrounded: 0, belowThreshold: 0, duplicates: 0 },
      usage,
      calls: 0,
      files,
      redactions,
      empty: true,
    };
  }

  const system = buildSystemPrompt({ language: cfg.language, maxFindings: cfg.max_findings });
  const messages: { role: 'user' | 'assistant'; content: string }[] = [
    {
      role: 'user',
      content: buildUserPrompt({
        title,
        body,
        diffText: redacted.text,
        language: cfg.language,
        maxFindings: cfg.max_findings,
      }),
    },
  ];

  // Validate -> repair loop: on invalid output we show the model its own error once.
  let review: Review | undefined;
  let calls = 0;
  let lastError = '';
  for (let attempt = 0; attempt < 2 && !review; attempt++) {
    const res = await provider.complete({ system, messages, maxTokens: cfg.max_output_tokens });
    calls++;
    usage.inputTokens += res.usage.inputTokens;
    usage.outputTokens += res.usage.outputTokens;
    try {
      review = ReviewSchema.parse(extractJson(res.text));
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      messages.push({ role: 'assistant', content: res.text });
      messages.push({
        role: 'user',
        content: `Your reply was not valid. Error: ${lastError.slice(0, 600)}\nReturn ONLY the corrected JSON object.`,
      });
    }
  }
  if (!review) throw new Error(`Model output failed validation after retry: ${lastError}`);

  const grounded = groundFindings(review.findings, selected.included);
  const minRank = severityRank(cfg.min_severity);
  const aboveThreshold = grounded.kept.filter((f) => severityRank(f.severity) >= minRank);
  const unique = dedupe(aboveThreshold);
  const findings = [...unique.kept]
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
    .slice(0, cfg.max_findings);

  return {
    review,
    findings,
    dropped: {
      ungrounded: grounded.dropped,
      belowThreshold: grounded.kept.length - aboveThreshold.length,
      duplicates: unique.dropped,
    },
    usage,
    calls,
    files,
    redactions,
    empty: false,
  };
}

export function estimateCostUsd(usage: Usage, cfg: Config): number | undefined {
  if (!cfg.pricing) return undefined;
  return (
    (usage.inputTokens / 1e6) * cfg.pricing.input_per_mtok +
    (usage.outputTokens / 1e6) * cfg.pricing.output_per_mtok
  );
}
