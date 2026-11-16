const RETRYABLE = new Set([408, 429, 500, 502, 503, 504, 529]);

export interface PostOptions {
  /** Used in error messages, e.g. "Anthropic" -> "Anthropic API 401: ...". */
  label: string;
  fetchImpl: typeof fetch;
  maxRetries: number;
}

/** POST JSON with exponential backoff; honours Retry-After on 429/5xx (capped at 60s). */
export async function postJson<T>(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  opts: PostOptions,
): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    let res: Response;
    try {
      res = await opts.fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body) });
    } catch (e) {
      last = e; // network error: retry
      if (attempt >= opts.maxRetries) throw e;
      await sleep(backoffMs(attempt));
      continue;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = new Error(`${opts.label} API ${res.status}: ${text.slice(0, 300)}`);
      if (RETRYABLE.has(res.status) && attempt < opts.maxRetries) {
        last = err;
        await sleep(retryAfterMs(res) ?? backoffMs(attempt));
        continue;
      }
      throw err;
    }
    return (await res.json()) as T;
  }
  throw last;
}

function retryAfterMs(res: Response): number | undefined {
  const raw = res.headers?.get?.('retry-after');
  const secs = raw ? parseFloat(raw) : NaN;
  return Number.isFinite(secs) && secs >= 0 ? Math.min(secs, 60) * 1000 : undefined;
}

function backoffMs(attempt: number): number {
  return Math.min(8000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
