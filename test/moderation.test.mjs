import test from 'node:test';
import assert from 'node:assert/strict';
import { createIris, IrisAIError } from '../dist/esm/index.js';
import { mockFetch, reply, rules } from './helpers.mjs';

test('all filter combinations work independently', async () => {
  for (const keywordFilter of [true, false]) {
    for (const aiFilter of [true, false]) {
      const mock = mockFetch(reply('User Safety: unsafe'));
      const result = await createIris({ keywords: rules, keywordFilter, aiFilter,
        ai: { apiKey: 'test-token', fetch: mock.fetch } }).moderate('危险词');
      assert.equal(result.keywordResult.enabled, keywordFilter);
      assert.equal(result.keywordResult.hit, keywordFilter);
      assert.equal(result.aiResult.enabled, aiFilter);
      assert.equal(mock.calls.length, aiFilter ? 1 : 0);
      assert.equal(result.isIllegal, keywordFilter || aiFilter);
    }
  }
});

test('dangerous and extreme hits trigger AI; general/no hits skip by default', async () => {
  const mock = mockFetch();
  const iris = createIris({ keywords: rules, ai: { apiKey: 'test-token', fetch: mock.fetch } });
  for (const input of ['正常', '提醒']) {
    const result = await iris.moderate(input);
    assert.equal(result.aiResult.status, 'skipped');
    assert.equal(result.aiResult.result, null);
    assert.equal(result.isIllegal, false);
  }
  await iris.moderate('危险词');
  await iris.moderate('极危词');
  assert.equal(mock.calls.length, 2);
});

test('AI review can clear keyword false positives; any mode preserves keyword rejection', async () => {
  for (const decisionMode of ['ai-priority', 'any']) {
    const result = await createIris({ keywords: rules, decisionMode,
      ai: { apiKey: 'test-token', fetch: mockFetch().fetch } }).moderate('危险词');
    assert.equal(result.keywordResult.isIllegal, true);
    assert.equal(result.aiResult.result, false);
    assert.equal(result.isIllegal, decisionMode === 'any');
  }
});

test('empty dictionary and disabled keyword filter both allow AI-only moderation', async () => {
  for (const options of [{ keywords: [] }, { keywords: rules, keywordFilter: false }]) {
    const mock = mockFetch();
    const result = await createIris({ ...options, ai: { apiKey: 'test-token', fetch: mock.fetch } }).moderate('正常');
    assert.equal(result.aiResult.status, 'completed');
    assert.equal(mock.calls.length, 1);
  }
});

test('always trigger and configurable severity threshold are respected', async () => {
  for (const ai of [{ trigger: 'always' }, { minSeverity: 'general' }]) {
    const mock = mockFetch();
    const result = await createIris({ keywords: rules, ai: { ...ai, apiKey: 'test-token', fetch: mock.fetch } }).moderate('提醒');
    assert.equal(result.aiResult.status, 'completed');
  }
  const mock = mockFetch();
  const result = await createIris({ keywords: rules, ai: { minSeverity: 'extreme', apiKey: 'test-token', fetch: mock.fetch } }).moderate('危险词');
  assert.equal(result.isIllegal, true);
  assert.equal(result.aiResult.status, 'skipped');
  assert.equal(mock.calls.length, 0);
});

test('per-request switches override instance defaults without mutation', async () => {
  const mock = mockFetch();
  const iris = createIris({ keywords: rules, ai: { apiKey: 'test-token', fetch: mock.fetch } });
  assert.equal((await iris.moderate('危险词', { aiFilter: false })).aiResult.status, 'disabled');
  assert.equal((await iris.moderate('危险词')).aiResult.status, 'completed');
  assert.equal((await iris.moderate('危险词', { keywordFilter: false, aiFilter: false })).isIllegal, false);
});

test('empty strings and whitespace never call AI', async () => {
  const mock = mockFetch();
  for (const input of ['', '\n \t']) {
    const result = await createIris({ ai: { apiKey: 'test-token', fetch: mock.fetch } }).moderate(input);
    assert.equal(result.aiResult.skipReason, 'empty-input');
    assert.equal(result.isIllegal, false);
  }
  assert.equal(mock.calls.length, 0);
});

test('missing key only matters when AI is actually needed', async () => {
  const iris = createIris({ keywords: rules, ai: { apiKey: '' } });
  assert.equal((await iris.moderate('正常')).isIllegal, false);
  const result = await iris.moderate('危险词');
  assert.equal(result.aiResult.error.code, 'MISSING_API_KEY');
  assert.equal(result.isIllegal, true);
  assert.equal(result.needsReview, true);
});

test('error modes can throw or fall back explicitly with needsReview', async () => {
  await assert.rejects(() => createIris({ ai: { apiKey: '', onError: 'throw' } }).moderate('test'), IrisAIError);
  const result = await createIris({ ai: { apiKey: '', onError: 'keyword-only' } }).moderate('test');
  assert.equal(result.isIllegal, false);
  assert.equal(result.needsReview, true);
  assert.equal(result.aiResult.result, null);
});

test('parallel calls do not share results or leak per-request settings', async () => {
  const iris = createIris({ keywords: rules, aiFilter: false });
  const results = await Promise.all(['提醒', '危险词', '正常'].map(input => iris.moderate(input)));
  assert.deepEqual(results.map(result => result.isIllegal), [false, true, false]);
  results[0].keywordResult.matches[0].comment = 'changed';
  assert.equal((await iris.moderate('提醒')).keywordResult.comment, '一般提示');
});

test('runtime validation catches invalid JavaScript options and inputs', async () => {
  for (const options of [
    { maxInputLength: -1 }, { maxMatches: 0 }, { keywordFilter: 'false' }, { aiFilter: 0 },
    { blockSeverity: 'bad' }, { decisionMode: 'bad' }, { ai: { timeoutMs: Infinity } },
    { ai: { model: '' } }, { ai: { apiKey: 123 } }, { ai: { minSeverity: 'bad' } },
    { ai: { onError: 'ignore' } }, { ai: { fetch: 123 } }, { ai: { protocol: 'xml' } },
    { ai: { policy: 'custom' } }, { ai: { structuredOutput: true } },
  ]) assert.throws(() => createIris(options));
  await assert.rejects(() => createIris().moderate(123), TypeError);
  await assert.rejects(() => createIris().moderate('test', { aiFilter: 'false' }), TypeError);
});
