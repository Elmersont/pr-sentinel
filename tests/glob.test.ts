import { globToRegExp, matchesAny } from '../src/glob';

describe('glob', () => {
  it.each([
    ['**/*.min.js', 'a/b/app.min.js', true],
    ['**/*.min.js', 'app.min.js', true],
    ['**/*.min.js', 'app.js', false],
    ['dist/**', 'dist/a/b.js', true],
    ['dist/**', 'src/dist/b.js', false],
    ['*.md', 'README.md', true],
    ['*.md', 'docs/README.md', false],
    ['src/?.ts', 'src/a.ts', true],
    ['src/?.ts', 'src/ab.ts', false],
    ['a.b', 'axb', false], // "." is literal
  ])('%s vs %s -> %s', (glob, path, expected) => {
    expect(globToRegExp(glob).test(path)).toBe(expected);
  });
  it('matchesAny', () => expect(matchesAny('x/yarn.lock', ['**/*.lock'])).toBe(true));
});
