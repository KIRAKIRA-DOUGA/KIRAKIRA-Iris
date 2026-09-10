import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createIris } from 'kirakira-iris';

test('ESM package export is usable', async () => {
  const result = await createIris().moderate('test');
  assert.equal(result.hit, false);
});

test('CommonJS package export is usable', async () => {
  const require = createRequire(import.meta.url);
  const pkg = require('kirakira-iris');
  const result = await pkg.createIris().moderate('test');
  assert.equal(result.hit, false);
  assert.equal(typeof pkg.normalizeText, 'function');
  assert.equal(pkg.createIris({ keywords: ['危险词'] }).keywordModerate('危險詞').hit, true);
});

test('release validation accepts only the exact stable version tag', () => {
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  for (const [tag, success] of [[`v${version}`, true], ['main', false], [`v${version}-wrong`, false], [version, false]]) {
    const run = spawnSync(process.execPath, ['scripts/check-release.mjs'], {
      env: { ...process.env, RELEASE_TAG: tag }, encoding: 'utf8',
    });
    assert.equal(run.status === 0, success, run.stderr);
  }
});
