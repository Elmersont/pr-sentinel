import type { Config } from './config';
import { estimateCostUsd, fingerprint, ReviewResult } from './review';
import type { Finding, Severity } from './schema';

export const MARKER = '<!-- pr-sentinel -->';
const CREATED_RE = /<!-- ps:created:([a-f0-9,]*) -->/;
const INLINED_RE = /<!-- ps:inlined:([a-f0-9,]*) -->/;

const ICON: Record<Severity, string> = {
  critical: '🔴',
  high: '🟠',
  medium: '🟡',
  low: '🔵',
  info: '⚪',
};
const RISK_ICON = { low: '🟢', medium: '🟡', high: '🔴' } as const;

/**
 * Model text is untrusted: stop it from pinging people, hiding HTML comments
 * (our state markers live in HTML comments) or injecting raw HTML.
 */
export function safeText(s: string): string {
  return s
    .replace(/<!--/g, '&lt;!--')
    .replace(/<(\/?)(script|iframe|img|style|a)\b/gi, '&lt;$1$2')
    .replace(/(^|[^\w`])@([A-Za-z0-9_-]+)/g, '$1@​$2');
}

/** Fingerprints of findings that already produced a Jira ticket on an earlier run. */
export function parseCreatedFingerprints(commentBody: string | undefined): Set<string> {
  const m = commentBody?.match(CREATED_RE);
  return new Set(m && m[1] ? m[1].split(',').filter(Boolean) : []);
}

/** Fingerprints that already received an inline review comment on an earlier run. */
export function parseInlinedFingerprints(commentBody: string | undefined): Set<string> {
  const m = commentBody?.match(INLINED_RE);
  return new Set(m && m[1] ? m[1].split(',').filter(Boolean) : []);
}

export function formatFinding(f: Finding): string {
  const where = f.line ? `\`${f.file}:${f.line}\`` : `\`${f.file}\``;
  const lines = [
    `${ICON[f.severity]} **${f.severity.toUpperCase()}** · ${f.category} · ${where}`,
    `**${safeText(f.title)}**`,
    safeText(f.explanation),
  ];
  if (f.suggestion) lines.push(`> 💡 ${safeText(f.suggestion).replace(/\n/g, '\n> ')}`);
  return lines.join('\n\n');
}

export function formatReport(
  result: ReviewResult,
  cfg: Config,
  opts: {
    createdFingerprints?: Iterable<string>;
    inlinedFingerprints?: Iterable<string>;
    jiraKeys?: Record<string, string>;
  } = {},
): string {
  const { review, findings } = result;
  const out: string[] = [MARKER, '## 🛡️ PR Sentinel review', ''];

  out.push(`**Risk:** ${RISK_ICON[review.risk]} ${review.risk.toUpperCase()}` +
    (review.labels.length ? ` · ${review.labels.map((l) => `\`${safeText(l)}\``).join(' ')}` : ''));
  out.push('', safeText(review.summary), '');

  if (findings.length === 0) {
    out.push('✅ No actionable findings.', '');
  } else {
    const counts = findings.reduce<Record<string, number>>((acc, f) => {
      acc[f.severity] = (acc[f.severity] ?? 0) + 1;
      return acc;
    }, {});
    out.push(
      `**${findings.length} finding${findings.length === 1 ? '' : 's'}:** ` +
        (['critical', 'high', 'medium', 'low', 'info'] as Severity[])
          .filter((s) => counts[s])
          .map((s) => `${ICON[s]} ${counts[s]} ${s}`)
          .join(' · '),
      '',
    );
    findings.forEach((f, i) => {
      const jira = opts.jiraKeys?.[fingerprint(f)];
      out.push(`<details${i < 3 ? ' open' : ''}><summary>${ICON[f.severity]} ${safeText(f.title)}</summary>`, '');
      out.push(formatFinding(f));
      if (jira) out.push('', `🎫 Jira: \`${jira}\``);
      out.push('', '</details>', '');
    });
  }

  // Footer: transparency about what was and was not reviewed, and what it cost.
  const cost = estimateCostUsd(result.usage, cfg);
  const meta = [
    `${result.files.reviewed.length} file(s) reviewed`,
    result.files.skipped.length ? `${result.files.skipped.length} skipped` : '',
    result.redactions.count ? `${result.redactions.count} secret(s) redacted before sending` : '',
    result.dropped.ungrounded ? `${result.dropped.ungrounded} ungrounded finding(s) discarded` : '',
    `${result.usage.inputTokens + result.usage.outputTokens} tokens (${result.calls} call${result.calls === 1 ? '' : 's'})`,
    cost !== undefined ? `~$${cost.toFixed(4)}` : '',
    cfg.model,
  ].filter(Boolean);
  out.push('---', `<sub>${meta.join(' · ')}</sub>`);

  const created = [...(opts.createdFingerprints ?? [])];
  if (created.length) out.push(`<!-- ps:created:${created.join(',')} -->`);
  const inlined = [...(opts.inlinedFingerprints ?? [])];
  if (inlined.length) out.push(`<!-- ps:inlined:${inlined.join(',')} -->`);
  return out.join('\n');
}
