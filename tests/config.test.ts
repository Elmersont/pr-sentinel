import { effectiveIgnore, parseConfig } from '../src/config';

describe('parseConfig', () => {
  it('applies defaults for empty or missing files', () => {
    for (const input of [undefined, '', '   \n']) {
      const c = parseConfig(input);
      expect(c.language).toBe('en');
      expect(c.fail_on).toBe('none');
      expect(c.integrations.jira.enabled).toBe(false);
      expect(c.max_findings).toBe(15);
    }
  });

  it('reads overrides and merges ignore globs with the built-ins', () => {
    const c = parseConfig('language: es\nfail_on: high\nignore:\n  - "docs/**"\nintegrations:\n  jira:\n    enabled: true\n    project_key: ENG');
    expect(c.language).toBe('es');
    expect(c.fail_on).toBe('high');
    expect(c.integrations.jira.project_key).toBe('ENG');
    expect(c.integrations.jira.min_severity).toBe('high');
    expect(effectiveIgnore(c)).toEqual(expect.arrayContaining(['docs/**', '**/package-lock.json']));
  });

  it('rejects invalid values with a readable message', () => {
    expect(() => parseConfig('fail_on: banana')).toThrow(/Invalid \.ai-review\.yml: fail_on/);
    expect(() => parseConfig('max_findings: 0')).toThrow(/max_findings/);
  });
});
