/**
 * Local usage:
 *   ANTHROPIC_API_KEY=... npx tsx src/cli.ts --diff change.diff [--config .ai-review.yml]
 *   git diff main | ANTHROPIC_API_KEY=... npx tsx src/cli.ts --diff -
 */
import { existsSync, readFileSync } from 'fs';
import { parseConfig } from './config';
import { formatReport } from './format';
import { AnthropicProvider } from './llm/anthropic';
import { runReview } from './review';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const diffPath = arg('diff');
  if (!diffPath) {
    console.error('Usage: cli --diff <file|-> [--config .ai-review.yml] [--title "..."]');
    process.exit(2);
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('Set ANTHROPIC_API_KEY.');
    process.exit(2);
  }
  const diff = diffPath === '-' ? readFileSync(0, 'utf8') : readFileSync(diffPath, 'utf8');
  const configPath = arg('config') ?? '.ai-review.yml';
  const cfg = parseConfig(existsSync(configPath) ? readFileSync(configPath, 'utf8') : undefined);

  const result = await runReview(
    { title: arg('title') ?? 'Local review', body: '', diff },
    cfg,
    new AnthropicProvider({ apiKey, model: cfg.model }),
  );
  console.log(formatReport(result, cfg));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
