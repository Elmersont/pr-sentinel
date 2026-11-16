/**
 * Eval harness.
 *   LLM_API_KEY=... npm run eval -- --config examples/gemini.yml --delay-ms 8000   # real model (the number that matters)
 *   npm run eval -- --provider oracle      # harness sanity: must score 100% recall
 *   npm run eval -- --provider silent      # harness sanity: must score 0% recall
 * Options: --config <yml>  --model <id>  --delay-ms <n> (pause between cases, for free-tier rate limits)
 *          --min-recall 0.75  --out results.json
 * LLM_API_KEY falls back to ANTHROPIC_API_KEY.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { parseConfig } from '../src/config';
import { createProvider } from '../src/llm/factory';
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
  const which = arg('provider') === 'anthropic' ? 'real' : (arg('provider') ?? 'real');
  const configPath = arg('config');
  if (configPath && !existsSync(configPath)) {
    console.error(`Config file not found: ${configPath}`);
    process.exit(2);
  }
  const cfg = parseConfig(configPath ? readFileSync(configPath, 'utf8') : undefined);
  if (arg('model')) cfg.model = arg('model') as string;
  const delayMs = parseInt(arg('delay-ms') ?? '0', 10);

  let real: LLMProvider | undefined;
  if (which === 'real') {
    const key = process.env.LLM_API_KEY ?? process.env.ANTHROPIC_API_KEY;
    if (!key) {
      console.error('LLM_API_KEY (or ANTHROPIC_API_KEY) is required for the real eval, or use --provider oracle|silent.');
      process.exit(2);
    }
    real = createProvider(cfg, key);
  }

  const only = arg('only');
  const ids = readdirSync(CASES_DIR).filter((f) => f.endsWith('.json') && (!only || f.includes(only))).sort();
  const scores: CaseScore[] = [];
  let tokens = 0;
  let errors = 0;

  for (const [i, file] of ids.entries()) {
    if (which === 'real' && delayMs > 0 && i > 0) await new Promise((r) => setTimeout(r, delayMs));
    const c: EvalCase = JSON.parse(readFileSync(join(CASES_DIR, file), 'utf8'));
    const diff = readFileSync(join(CASES_DIR, file.replace('.json', '.diff')), 'utf8');
    const provider = which === 'oracle' ? oracleFor(c) : which === 'silent' ? silent : (real as LLMProvider);
    let result;
    const started = Date.now();
    console.error(`...   ${c.id} (calling model)`);
    try {
      result = await runReview({ title: c.description, body: '', diff }, cfg, provider);
    } catch (e) {
      console.error(`ERR   ${c.id.padEnd(24)} ${e instanceof Error ? e.message : e}`);
      scores.push({ id: c.id, expected: c.expected.length, matched: 0, falsePositives: c.clean ? 1 : 0, clean: c.clean }); // an errored clean case must not count as a pass
      errors++;
      continue;
    }
    console.error(`      ${c.id} answered in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    tokens += result.usage.inputTokens + result.usage.outputTokens;
    const s = scoreCase(c, result.findings);
    scores.push(s);
    const status = c.clean ? (s.falsePositives === 0 ? 'PASS' : 'FAIL') : s.matched === s.expected ? 'HIT ' : 'MISS';
    console.log(`${status}  ${c.id.padEnd(24)} matched ${s.matched}/${s.expected}  false+ ${s.falsePositives}`);
  }

  const sum = summarize(scores);
  console.log('\n' + '-'.repeat(60));
  console.log(`provider: ${which === 'real' ? `${cfg.provider} (${cfg.model})` : which}`);
  if (errors) console.log(`WARNING: ${errors} case(s) errored and count as misses. Re-run, or raise --delay-ms if you hit rate limits.`);
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
