import test from 'node:test';
import assert from 'node:assert/strict';
import { createIris } from '../dist/esm/index.js';
import { deferred, flush, reply } from './helpers.mjs';

test('refresh replaces the full string dictionary for both original and normalized matching', () => {
  const iris = createIris({ keywords: ['旧词'] });
  assert.equal(iris.keywordModerate('舊詞').hit, true);
  assert.equal(iris.refreshKeywords(['新詞', 'ＡＢＣ']), undefined);
  assert.equal(iris.keywordModerate('旧词舊詞').hit, false);
  assert.deepEqual(iris.keywordModerate('新詞').matches[0].matchedIn, ['source', 'normalized']);
  assert.equal(iris.keywordModerate('新-词').hitWord, '新詞');
  assert.equal(iris.keywordModerate('a\nb.c').hitWord, 'ＡＢＣ');
  iris.refreshKeywords([]);
  assert.equal(iris.keywordModerate('旧词新詞abc').isIllegal, false);
});

test('invalid refresh preserves the previous dictionary without applying partial changes', () => {
  const iris = createIris({ keywords: ['original'] });
  for (const invalid of ['invalid', null, ['replacement', ''], [{ word: 'replacement', comment: 123 }]]) {
    assert.throws(() => iris.refreshKeywords(invalid), TypeError);
    assert.equal(iris.keywordModerate('original').isIllegal, true);
    assert.equal(iris.keywordModerate('replacement').hit, false);
  }
});

test('initial and refreshed dictionaries are snapshots of caller-supplied arrays and rules', () => {
  const initial = ['original'];
  const iris = createIris({ keywords: initial });
  initial.length = 0;
  assert.equal(iris.keywordModerate('original').hit, true);
  const rule = { word: '新詞', id: 'v2', comment: 'copied' };
  const next = [rule, 'abc'];
  iris.refreshKeywords(next);
  rule.word = 'mutated';
  rule.comment = 'changed';
  next.length = 0;
  const result = iris.keywordModerate('新词');
  assert.equal(result.hitWord, '新詞');
  assert.equal(result.comment, 'copied');
  assert.equal(result.matches[0].id, 'v2');
  assert.equal(iris.keywordModerate('abc').hit, true);
  assert.equal(iris.keywordModerate('mutated').hit, false);
});

test('refresh preserves in-flight and queued results, and subsequent calls use the new dictionary', async () => {
  const firstRequest = deferred();
  const calls = [];
  const iris = createIris({ keywords: ['旧词'], ai: {
    apiKey: 'test-token',
    fetch: async (_url, init) => {
      calls.push(JSON.parse(init.body).messages[0].content);
      return calls.length === 1 ? firstRequest.promise : reply();
    },
  } });
  const first = iris.moderate('旧词');
  const queued = iris.moderate('旧词');
  await flush();
  const stats = iris.getAIQueueStats();
  assert.equal(stats.active, 1);
  assert.equal(stats.queued, 1);
  iris.refreshKeywords(['新词']);
  assert.deepEqual(iris.getAIQueueStats(), stats);
  const after = await iris.moderate('旧词');
  assert.equal(after.keywordResult.hit, false);
  assert.equal(after.aiResult.status, 'skipped');
  assert.equal(after.aiResult.skipReason, 'no-keyword-hit');
  assert.equal(after.isIllegal, false);
  assert.deepEqual(iris.getAIQueueStats(), stats);
  firstRequest.resolve(reply());
  for (const result of await Promise.all([first, queued])) {
    assert.equal(result.keywordResult.hitWord, '旧词');
    assert.equal(result.aiResult.result, false);
    assert.equal(result.isIllegal, true);
  }
  assert.equal((await iris.moderate('新词')).isIllegal, true);
  assert.deepEqual(calls, ['旧词', '旧词', '新词']);
  assert.equal(iris.getAIQueueStats().active, 0);
});
