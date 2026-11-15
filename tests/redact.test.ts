import { redactSecrets } from '../src/redact';

describe('redactSecrets', () => {
  it('masks well-known token formats', () => {
    const input = [
      'aws = AKIAIOSFODNN7EXAMPLE',
      'gh = ghp_abcdefghijklmnopqrstuvwxyz0123456789',
      'llm = sk-ant-api03-abcdefghijklmnopqrstuvwxyz',
      'slack = xoxb-1234567890-abcdefghij',
      'jwt = eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0NTY3.SflKxwRJSMeKKF2QT4fwpM',
    ].join('\n');
    const r = redactSecrets(input);
    expect(r.count).toBe(5);
    expect(r.text).not.toMatch(/AKIA|ghp_|sk-ant|xoxb|eyJ/);
    expect(r.kinds).toEqual(expect.arrayContaining(['aws-access-key', 'github-token', 'llm-api-key', 'slack-token', 'jwt']));
  });

  it('masks only the value of credential assignments and keeps the key name', () => {
    const r = redactSecrets(`const password = "hunter2hunter2";\napi_key: 'abcd1234efgh'`);
    expect(r.text).toContain('password = "[REDACTED:credential-assignment]"');
    expect(r.text).toContain("api_key: '[REDACTED:credential-assignment]'");
  });

  it('keeps line count stable when a multi-line private key is removed', () => {
    const key = '-----BEGIN RSA PRIVATE KEY-----\nAAAA\nBBBB\n-----END RSA PRIVATE KEY-----';
    const input = `before\n${key}\nafter`;
    const r = redactSecrets(input);
    expect(r.text.split('\n').length).toBe(input.split('\n').length);
    expect(r.text).not.toContain('AAAA');
  });

  it('leaves normal code and short values alone', () => {
    const code = 'const token = "abc";\nconst skeleton = 1;\nfunction password() {}';
    const r = redactSecrets(code);
    expect(r.count).toBe(0);
    expect(r.text).toBe(code);
  });
});
