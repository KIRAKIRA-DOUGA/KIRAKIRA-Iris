import test from 'node:test';
import assert from 'node:assert/strict';
import { createIris } from '../dist/esm/index.js';
import { deferred, flush, reply } from './helpers.mjs';

test('refresh replaces the full string dictionary for both original and normalized matching', () => {
  const iris = createIris({ keywords: ['旧词'] });
  assert.equal(iris.keywordModerate('舊詞').hit, true);
  assert.equal(iris.refreshKeywords(['新詞', 'ＡＢＣ']), undefined);
  assert.equal(iris.keywordModerate('旧词舊詞').hit, false);
  assert.equal(iris.keywordModerate('新詞').matchesInSource[0].hitWord, '新詞');
  assert.equal(iris.keywordModerate('新-词').matchesInNormalize[0].hitWord, '新詞');
  assert.equal(iris.keywordModerate('a\nb.c').matchesInNormalize[0].hitWord, 'ＡＢＣ');
  iris.refreshKeywords([]);
  assert.equal(iris.keywordModerate('旧词新詞abc').hit, false);
});

test('invalid refresh preserves the previous dictionary without applying partial changes', () => {
  const iris = createIris({ keywords: ['original'] });
  for (const invalid of ['invalid', null, ['replacement', ''], [{ word: 'replacement' }]]) {
    assert.throws(() => iris.refreshKeywords(invalid), TypeError);
    assert.equal(iris.keywordModerate('original').hit, true);
    assert.equal(iris.keywordModerate('replacement').hit, false);
  }
});

test('initial and refreshed dictionaries are snapshots of caller-supplied string arrays', () => {
  const initial = ['original'];
  const iris = createIris({ keywords: initial });
  initial.length = 0;
  assert.equal(iris.keywordModerate('original').hit, true);
  const next = ['新詞', 'abc'];
  iris.refreshKeywords(next);
  next[0] = 'mutated';
  next.length = 0;
  const result = iris.keywordModerate('新词');
  assert.equal(result.matchesInNormalize[0].hitWord, '新詞');
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
  assert.equal(after.aiResult.status, 'drop');
  assert.equal(after.aiResult.skipReason, 'no-keyword-hit');
  assert.equal(after.hit, false);
  assert.deepEqual(iris.getAIQueueStats(), stats);
  firstRequest.resolve(reply());
  for (const result of await Promise.all([first, queued])) {
    assert.equal(result.keywordResult.matchesInSource[0].hitWord, '旧词');
    assert.equal(result.aiResult.status, 'pass');
    assert.equal(result.hit, true);
  }
  assert.equal((await iris.moderate('新词')).hit, true);
  assert.deepEqual(calls, ['旧词', '旧词', '新词']);
  assert.equal(iris.getAIQueueStats().active, 0);
});
