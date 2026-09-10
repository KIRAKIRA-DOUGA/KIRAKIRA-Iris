import test from 'node:test';
import assert from 'node:assert/strict';
import { createIris } from '../dist/esm/index.js';
import { deferred, flush, mockFetch, reply } from './helpers.mjs';

test('keywordModerate is synchronous and never invokes AI', () => {
  const mock = mockFetch();
  const result = createIris({ keywords: ['命中'], ai: { apiKey: 'token', fetch: mock.fetch } }).keywordModerate('命中');
  assert.equal(result instanceof Promise, false);
  assert.equal(result.isIllegal, true);
  assert.equal(mock.calls.length, 0);
});

test('moderate always rejects every keyword hit even when AI reports safe', async () => {
  const mock = mockFetch();
  const iris = createIris({ keywords: ['提醒', '危险词'], ai: { apiKey: 'token', fetch: mock.fetch } });
  for (const content of ['提醒', '危险词']) {
    const result = await iris.moderate(content);
    assert.equal(result.keywordResult.hit, true);
    assert.equal(result.aiResult.result, false);
    assert.equal(result.isIllegal, true);
    assert.equal(result.needsReview, false);
  }
  assert.equal(mock.calls.length, 2);
});

test('combined review skips AI without keyword hits, including an empty dictionary', async () => {
  for (const keywords of [[], ['命中']]) {
    const mock = mockFetch(reply('User Safety: unsafe'));
    const result = await createIris({ keywords, ai: { apiKey: 'token', fetch: mock.fetch } }).moderate('user-content');
    assert.equal(result.keywordResult.hit, false);
    assert.equal(result.isIllegal, false);
    assert.equal(result.aiResult.result, null);
    assert.equal(result.aiResult.status, 'skipped');
    assert.equal(result.aiResult.skipReason, 'no-keyword-hit');
    assert.equal(result.aiResult.comment, '未命中关键词，跳过 AI 审核。');
    assert.equal(result.aiResult.error, null);
    assert.deepEqual(result.aiResult.assessments, []);
    assert.equal(result.needsReview, false);
    assert.equal(mock.calls.length, 0);
  }
});

test('unmatched content bypasses a full AI queue and consumes no request quota', async () => {
  const firstRequest = deferred();
  const calls = [];
  const iris = createIris({ keywords: ['命中'], ai: {
    apiKey: 'token', maxQueueSize: 0, rateLimit: { maxRequests: 2, intervalMs: 60_000 },
    fetch: async (_url, init) => {
      calls.push(JSON.parse(init.body).messages[0].content);
      return calls.length === 1 ? firstRequest.promise : reply();
    },
  } });
  const active = iris.aiModerate('active');
  await flush();
  const before = iris.getAIQueueStats();
  const unmatched = await iris.moderate('正常');
  assert.equal(unmatched.aiResult.status, 'skipped');
  assert.equal(unmatched.aiResult.skipReason, 'no-keyword-hit');
  assert.equal(unmatched.aiResult.error, null);
  assert.equal(unmatched.needsReview, false);
  assert.deepEqual(iris.getAIQueueStats(), before);
  firstRequest.resolve(reply());
  await active;
  const matched = await iris.moderate('命中', { signal: AbortSignal.timeout(1_000) });
  assert.equal(matched.aiResult.status, 'completed');
  assert.equal(matched.isIllegal, true);
  assert.deepEqual(calls, ['active', '命中']);
});

test('combined moderation normalizes keyword matching but sends only the source to AI', async () => {
  const source = '前危-險\n詞後';
  const mock = mockFetch();
  const iris = createIris({ keywords: ['危险词'], ai: { apiKey: 'token', fetch: mock.fetch } });
  const result = await iris.moderate(source);
  assert.equal(result.keywordResult.hit, true);
  assert.equal(result.keywordResult.normalizeString, '前危险词后');
  assert.equal(result.aiResult.result, false);
  assert.equal(result.isIllegal, true);
  assert.equal(mock.calls.length, 1);
  assert.equal(mock.calls[0].body.messages[0].content, source);
});

test('omitting AI config keeps keyword moderation active', async () => {
  const result = await createIris({ keywords: ['命中'] }).moderate('命中');
  assert.equal(result.isIllegal, true);
  assert.equal(result.aiResult.status, 'disabled');
  assert.equal(result.aiResult.skipReason, 'not-configured');
});

test('aiModerate always reviews nonempty content and never consults keyword matches', async () => {
  const mock = mockFetch(reply('User Safety: safe'), reply('User Safety: unsafe'));
  const iris = createIris({ keywords: ['命中'], ai: { apiKey: 'token', fetch: mock.fetch } });
  assert.equal((await iris.aiModerate('命中')).result, false);
  assert.equal((await iris.aiModerate('正常')).result, true);
  assert.equal(mock.calls.length, 2);
});

test('AI-only review does not hit keyword match count limits', async () => {
  const iris = createIris({ keywords: ['a'], maxMatches: 1, ai: { apiKey: 'token', fetch: mockFetch().fetch } });
  assert.equal((await iris.aiModerate('aaa')).status, 'completed');
  assert.throws(() => iris.keywordModerate('aaa'), RangeError);
});

test('AI failure and cancellation cannot negate a keyword hit', async () => {
  const controller = new AbortController();
  controller.abort();
  const iris = createIris({ keywords: ['命中'], ai: { apiKey: 'token', fetch: mockFetch(new Response('', { status: 503 })).fetch } });
  for (const options of [{}, { signal: controller.signal }]) {
    const result = await iris.moderate('命中', options);
    assert.equal(result.isIllegal, true);
    assert.equal(result.aiResult.result, null);
    assert.equal(result.needsReview, true);
  }
});

test('environment credentials are never read, including a throwing getter', async () => {
  const originalEnv = process.env;
  process.env = new Proxy(originalEnv, {
    get(target, property) {
      if (property === 'OPENROUTER_API_KEY') throw new Error('Environment key accessed');
      return Reflect.get(target, property);
    },
  });
  try {
    const result = await createIris().aiModerate('test');
    assert.equal(result.error.code, 'MISSING_API_KEY');
    assert.throws(() => createIris({ ai: {} }), /apiKey/);
    assert.equal((await createIris({ ai: { apiKey: 'explicit', fetch: mockFetch().fetch } }).aiModerate('test')).status, 'completed');
  } finally { process.env = originalEnv; }
});

test('empty and whitespace calls skip AI without network requests', async () => {
  const mock = mockFetch();
  const iris = createIris({ ai: { apiKey: 'token', fetch: mock.fetch } });
  for (const content of ['', ' \r\n\t']) {
    assert.equal((await iris.aiModerate(content)).skipReason, 'empty-input');
    const combined = await iris.moderate(content);
    assert.equal(combined.aiResult.skipReason, 'empty-input');
    assert.equal(combined.keywordResult.hit, false);
    assert.equal(combined.isIllegal, false);
  }
  assert.equal(mock.calls.length, 0);
});

test('configuration is copied and result objects are independent', async () => {
  const options = { keywords: [{ word: '命中', comment: 'original' }], ai: { apiKey: 'token', rateLimit: { maxRequests: 10, intervalMs: 100 }, fetch: mockFetch().fetch } };
  const iris = createIris(options);
  options.ai.rateLimit.maxRequests = 0;
  options.ai.apiKey = '';
  const result = await iris.moderate('命中');
  assert.equal(result.aiResult.status, 'completed');
  result.keywordResult.matches[0].comment = 'changed';
  assert.equal(iris.keywordModerate('命中').comment, 'original');
});

test('rejects invalid limits, tokens and obsolete options in JavaScript', async () => {
  for (const options of [
    { maxInputLength: -1 }, { maxMatches: 0 }, { keywordFilter: false }, { aiFilter: true },
    { blockSeverity: 'general' }, { decisionMode: 'ai-priority' }, { ai: { apiKey: '' } },
    { ai: { apiKey: 3 } }, { ai: { apiKey: 'x', maxQueueSize: -1 } },
    { ai: { apiKey: 'x', maxConcurrent: 0 } }, { ai: { apiKey: 'x', timeoutMs: Infinity } },
    { ai: { apiKey: 'x', rateLimit: { maxRequests: 0, intervalMs: 10 } } },
    { ai: { apiKey: 'x', rateLimit: { maxRequests: 1 } } },
    { ai: { apiKey: 'x', rateLimit: null } },
    { ai: { apiKey: 'x', minSeverity: 'general' } }, { ai: { apiKey: 'x', trigger: 'always' } },
    { ai: { apiKey: 'x', reviewNormalized: true } },
    { ai: { apiKey: 'x', onError: 'throw' } }, { ai: { apiKey: 'x', fetch: 1 } },
    { ai: { apiKey: 'x', protocol: 'xml' } }, { ai: { apiKey: 'x', model: '' } },
    { ai: { apiKey: 'x', policy: 'custom' } }, { ai: { apiKey: 'x', structuredOutput: true } },
  ]) assert.throws(() => createIris(options));
  await assert.rejects(() => createIris().moderate(3), TypeError);
  await assert.rejects(() => createIris().moderate('x', { keywordFilter: false }), /removed/);
});
