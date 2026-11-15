/**
 * Eval harness.
 *   ANTHROPIC_API_KEY=... npm run eval                 # real model (the number that matters)
 *   npm run eval -- --provider oracle                  # harness sanity: must score 100% recall
 *   npm run eval -- --provider silent                  # harness sanity: must score 0% recall
 * Options: --model <id>  --min-recall 0.75  --out results.json
 */
import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { parseConfig } from '../src/config';
import { AnthropicProvider } from '../src/llm/anthropic';
import type { CompletionResult, LLMProvider } from '../src/llm/provider';
import { runReview } from '../src/review';
import { CaseScore, EvalCase, scoreCase, summarize } from './score';

const CASES_DIR = join(__dirname, 'cases');

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function reply(findings: unknown[], risk: 'low' | 'high'): CompletionResult {
  return {
    text: JSON.stringify({ summary: 'Offline harness reply.', risk, labels: [], findings }),
    usage: { inputTokens: 0, outputTokens: 0 },
  };
}

function oracleFor(c: EvalCase): LLMProvider {
  return {
    name: 'oracle',
    async complete() {
      return reply(
        c.expected.map((e) => ({
          severity: 'high',
          category: e.categories[0],
          file: e.file,
          line: e.lines[0],
          title: `Expected issue in ${e.file}`,
          explanation: 'Injected by the oracle provider to validate scoring.',
          suggestion: null,
        })),
        c.expected.length ? 'high' : 'low',
      );
    },
  };
}

const silent: LLMProvider = { name: 'silent', async complete() { return reply([], 'low'); } };

async function main() {
  const which = arg('provider') ?? 'anthropic';
  const cfg = parseConfig(undefined);
  if (arg('model')) cfg.model = arg('model') as string;

  let real: LLMProvider | undefined;
  if (which === 'anthropic') {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) {
      console.error('ANTHROPIC_API_KEY is required for the real eval (or use --provider oracle|silent).');
      process.exit(2);
    }
    real = new AnthropicProvider({ apiKey: key, model: cfg.model });
  }

  const ids = readdirSync(CASES_DIR).filter((f) => f.endsWith('.json')).sort();
  const scores: CaseScore[] = [];
  let tokens = 0;

  for (const file of ids) {
    const c: EvalCase = JSON.parse(readFileSync(join(CASES_DIR, file), 'utf8'));
    const diff = readFileSync(join(CASES_DIR, file.replace('.json', '.diff')), 'utf8');
    const provider = which === 'oracle' ? oracleFor(c) : which === 'silent' ? silent : (real as LLMProvider);
    const result = await runReview({ title: c.description, body: '', diff }, cfg, provider);
    tokens += result.usage.inputTokens + result.usage.outputTokens;
    const s = scoreCase(c, result.findings);
    scores.push(s);
    const status = c.clean ? (s.falsePositives === 0 ? 'PASS' : 'FAIL') : s.matched === s.expected ? 'HIT ' : 'MISS';
    console.log(`${status}  ${c.id.padEnd(24)} matched ${s.matched}/${s.expected}  false+ ${s.falsePositives}`);
  }

  const sum = summarize(scores);
  console.log('\n' + '-'.repeat(60));
  console.log(`provider: ${which}${which === 'anthropic' ? ` (${cfg.model})` : ''}`);
  console.log(`recall: ${(sum.recall * 100).toFixed(0)}%   false positives: ${sum.falsePositives}   clean cases passed: ${sum.cleanCasesPassed}/${sum.cleanCases}   tokens: ${tokens}`);

  if (arg('out')) writeFileSync(arg('out') as string, JSON.stringify({ provider: which, model: cfg.model, summary: sum, scores }, null, 2));
  const min = parseFloat(arg('min-recall') ?? '0');
  if (sum.recall < min) {
    console.error(`recall ${sum.recall.toFixed(2)} is below --min-recall ${min}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
