import * as core from '@actions/core';
import * as github from '@actions/github';
import { existsSync, readFileSync } from 'fs';
import { effectiveIgnore, parseConfig } from './config';
import { formatReport, parseCreatedFingerprints, parseInlinedFingerprints } from './format';
import { findStickyComment, getPrDiff, postInlineReview, upsertComment } from './github';
import { createJiraIssues } from './integrations/jira';
import { postWebhook, shouldNotify, slackPayload, teamsPayload } from './integrations/chat';
import { AnthropicProvider } from './llm/anthropic';
import { estimateCostUsd, fingerprint, runReview } from './review';
import { severityRank } from './schema';

async function run(): Promise<void> {
  const pr = github.context.payload.pull_request;
  if (!pr) {
    core.info('Not a pull_request event; nothing to do.');
    return;
  }

  const apiKey = core.getInput('anthropic_api_key');
  if (!apiKey) {
    // Fork PRs do not receive secrets. Skip quietly instead of failing the check.
    core.warning('anthropic_api_key is empty (fork PR or missing secret). Skipping review.');
    return;
  }

  const configPath = core.getInput('config_path') || '.ai-review.yml';
  const cfg = parseConfig(existsSync(configPath) ? readFileSync(configPath, 'utf8') : undefined);
  const modelOverride = core.getInput('model');
  if (modelOverride) cfg.model = modelOverride;

  const target = { owner: github.context.repo.owner, repo: github.context.repo.repo, number: pr.number };
  const octokit = github.getOctokit(core.getInput('github_token', { required: true }));

  const diff = await getPrDiff(octokit, target);
  const provider = new AnthropicProvider({ apiKey, model: cfg.model });
  const result = await runReview({ title: pr.title ?? '', body: pr.body ?? '', diff }, cfg, provider);

  const prRef = {
    repo: `${target.owner}/${target.repo}`,
    number: pr.number,
    url: pr.html_url as string,
    title: pr.title as string,
  };

  const existing = await findStickyComment(octokit, target);
  const createdFps = parseCreatedFingerprints(existing?.body);
  const inlinedFps = parseInlinedFingerprints(existing?.body);
  const jiraKeys: Record<string, string> = {};

  // Jira: one ticket per sufficiently severe finding, idempotent across pushes.
  const jiraCfg = cfg.integrations.jira;
  const jiraBase = core.getInput('jira_base_url');
  if (jiraCfg.enabled && jiraBase && jiraCfg.project_key) {
    const eligible = result.findings.filter(
      (f) => severityRank(f.severity) >= severityRank(jiraCfg.min_severity),
    );
    const jira = await createJiraIssues(
      {
        baseUrl: jiraBase,
        email: core.getInput('jira_email'),
        apiToken: core.getInput('jira_api_token'),
        projectKey: jiraCfg.project_key,
        issueType: jiraCfg.issue_type,
        labels: jiraCfg.labels,
      },
      eligible,
      prRef,
      createdFps,
    );
    for (const c of jira.created) {
      createdFps.add(c.fingerprint);
      jiraKeys[c.fingerprint] = c.key;
    }
    jira.errors.forEach((e) => core.warning(`Jira: ${e.message}`));
    core.info(`Jira: ${jira.created.length} created, ${jira.skipped.length} already existed.`);
  } else if (jiraCfg.enabled) {
    core.warning('Jira integration enabled but jira_base_url or project_key is missing.');
  }

  // Optional inline comments (only for findings not already commented).
  if (cfg.inline_comments) {
    try {
      const fresh = result.findings.filter((f) => !inlinedFps.has(fingerprint(f)));
      const n = await postInlineReview(octokit, target, fresh);
      fresh.filter((f) => f.line !== null).forEach((f) => inlinedFps.add(fingerprint(f)));
      core.info(`Posted ${n} inline comment(s).`);
    } catch (e) {
      core.warning(`Inline comments failed (summary comment still posted): ${(e as Error).message}`);
    }
  }

  const body = formatReport(result, cfg, {
    createdFingerprints: createdFps,
    inlinedFingerprints: inlinedFps,
    jiraKeys,
  });
  await upsertComment(octokit, target, body, existing?.id);

  // Chat notifications.
  const { teams, slack } = cfg.integrations;
  const teamsUrl = core.getInput('teams_webhook_url');
  const slackUrl = core.getInput('slack_webhook_url');
  if (teams.enabled && teamsUrl && shouldNotify(result.review.risk, teams.min_risk)) {
    await postWebhook(teamsUrl, teamsPayload(result, prRef)).catch((e) =>
      core.warning(`Teams notification failed: ${(e as Error).message}`),
    );
  }
  if (slack.enabled && slackUrl && shouldNotify(result.review.risk, slack.min_risk)) {
    await postWebhook(slackUrl, slackPayload(result, prRef)).catch((e) =>
      core.warning(`Slack notification failed: ${(e as Error).message}`),
    );
  }

  // Outputs for downstream steps.
  core.setOutput('risk', result.review.risk);
  core.setOutput('findings_count', String(result.findings.length));
  core.setOutput('tokens', String(result.usage.inputTokens + result.usage.outputTokens));
  const cost = estimateCostUsd(result.usage, cfg);
  if (cost !== undefined) core.setOutput('cost_usd', cost.toFixed(4));
  core.debug(`ignore globs: ${effectiveIgnore(cfg).join(', ')}`);

  if (cfg.fail_on !== 'none') {
    const threshold = severityRank(cfg.fail_on);
    const blocking = result.findings.filter((f) => severityRank(f.severity) >= threshold);
    if (blocking.length > 0) {
      core.setFailed(`${blocking.length} finding(s) at or above "${cfg.fail_on}" severity.`);
    }
  }
}

run().catch((e) => core.setFailed(e instanceof Error ? e.message : String(e)));
