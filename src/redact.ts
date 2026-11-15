interface Rule {
  name: string;
  re: RegExp;
}

// Order matters: specific formats first, generic assignments last.
const RULES: Rule[] = [
  { name: 'private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { name: 'aws-access-key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: 'github-token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b/g },
  { name: 'llm-api-key', re: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}\b/g },
  { name: 'slack-token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: 'jwt', re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  {
    name: 'credential-assignment',
    re: /((?:api[_-]?key|secret|token|passwd|password|pwd)["']?\s*[:=]\s*["'])([^"'\s]{8,})(["'])/gi,
  },
];

export interface RedactionResult {
  text: string;
  count: number;
  kinds: string[];
}

/** Masks likely secrets before any text leaves the runner. Line structure is preserved. */
export function redactSecrets(input: string): RedactionResult {
  let text = input;
  let count = 0;
  const kinds = new Set<string>();

  for (const rule of RULES) {
    text = text.replace(rule.re, (...args) => {
      count++;
      kinds.add(rule.name);
      if (rule.name === 'credential-assignment') {
        // keep the key name and quotes, mask only the value
        const [, pre, , post] = args as string[];
        return `${pre}[REDACTED:${rule.name}]${post}`;
      }
      const matched = args[0] as string;
      // keep newline count so annotated line numbers stay aligned
      const newlines = (matched.match(/\n/g) ?? []).join('');
      return `[REDACTED:${rule.name}]${newlines}`;
    });
  }
  return { text, count, kinds: [...kinds] };
}
