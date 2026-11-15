import type { ReviewResult } from '../review';
import type { PrRef } from './jira';

const RISK_ORDER = { low: 0, medium: 1, high: 2 } as const;

export function shouldNotify(risk: keyof typeof RISK_ORDER, minRisk: keyof typeof RISK_ORDER): boolean {
  return RISK_ORDER[risk] >= RISK_ORDER[minRisk];
}

function headline(result: ReviewResult, pr: PrRef): string {
  const n = result.findings.length;
  return `PR Sentinel: ${result.review.risk.toUpperCase()} risk on ${pr.repo}#${pr.number} (${n} finding${n === 1 ? '' : 's'})`;
}

/** Microsoft Teams (Workflows / Power Automate webhook) – Adaptive Card payload. */
export function teamsPayload(result: ReviewResult, pr: PrRef) {
  const top = result.findings.slice(0, 5).map((f) => `- **${f.severity}** ${f.title} (\`${f.file}\`)`);
  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body: [
            { type: 'TextBlock', text: headline(result, pr), weight: 'Bolder', wrap: true },
            { type: 'TextBlock', text: pr.title, wrap: true },
            { type: 'TextBlock', text: result.review.summary, wrap: true },
            ...(top.length ? [{ type: 'TextBlock', text: top.join('\n'), wrap: true }] : []),
          ],
          actions: [{ type: 'Action.OpenUrl', title: 'Open PR', url: pr.url }],
        },
      },
    ],
  };
}

/** Slack incoming-webhook payload. */
export function slackPayload(result: ReviewResult, pr: PrRef) {
  const top = result.findings.slice(0, 5).map((f) => `• *${f.severity}* ${f.title} (\`${f.file}\`)`);
  return {
    text: `${headline(result, pr)}\n<${pr.url}|${pr.title}>\n${result.review.summary}${top.length ? '\n' + top.join('\n') : ''}`,
  };
}

export async function postWebhook(
  url: string,
  payload: unknown,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Webhook responded ${res.status}`);
}
