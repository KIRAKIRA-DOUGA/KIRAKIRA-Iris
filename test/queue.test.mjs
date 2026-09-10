import test from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { createIris } from '../dist/esm/index.js';
import { AIScheduler } from '../dist/esm/scheduler.js';
import { deferred, flush, mockFetch, reply } from './helpers.mjs';

class ManualClock {
  time = 0;
  serial = 0;
  timers = new Map();
  now = () => this.time;
  setTimer = (callback, delay) => {
    const id = ++this.serial;
    this.timers.set(id, { at: this.time + delay, callback });
    return id;
  };
  clearTimer = id => { this.timers.delete(id); };
  advance(ms) {
    const target = this.time + ms;
    while (true) {
      const next = [...this.timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > target) break;
      this.time = next[1].at;
      this.timers.delete(next[0]);
      next[1].callback();
    }
    this.time = target;
  }
}

test('sliding window prevents boundary bursts and admits each request at the right time', async () => {
  const clock = new ManualClock();
  const scheduler = new AIScheduler({ maxConcurrent: 1, maxQueueSize: 10, rateLimit: { maxRequests: 2, intervalMs: 100 } }, clock);
  await scheduler.acquireRequest(); // t=0
  clock.advance(60);
  await scheduler.acquireRequest(); // t=60
  const admitted = [];
  const third = scheduler.acquireRequest().then(() => admitted.push(clock.now()));
  clock.advance(39);
  await flush();
  assert.deepEqual(admitted, []);
  clock.advance(1);
  await third;
  assert.deepEqual(admitted, [100]);
  const fourth = scheduler.acquireRequest().then(() => admitted.push(clock.now()));
  clock.advance(59);
  await flush();
  assert.deepEqual(admitted, [100]);
  clock.advance(1);
  await fourth;
  assert.deepEqual(admitted, [100, 160]);
  assert.equal(clock.timers.size, 0);
});

test('cancelling a rate-limited waiter clears its timer without consuming future quota', async () => {
  const clock = new ManualClock();
  const scheduler = new AIScheduler({ maxConcurrent: 1, maxQueueSize: 10, rateLimit: { maxRequests: 1, intervalMs: 100 } }, clock);
  await scheduler.acquireRequest();
  const abort = new AbortController();
  const waiting = scheduler.acquireRequest(abort.signal);
  const rejection = assert.rejects(waiting, { code: 'ABORTED' });
  assert.equal(clock.timers.size, 1);
  abort.abort();
  await rejection;
  assert.equal(clock.timers.size, 0);
  clock.advance(100);
  await scheduler.acquireRequest();
});

test('long-running rate limits prune history without losing throughput', async () => {
  const clock = new ManualClock();
  const scheduler = new AIScheduler({ maxConcurrent: 1, maxQueueSize: 1, rateLimit: { maxRequests: 1, intervalMs: 1 } }, clock);
  for (let i = 0; i < 2200; i++) {
    await scheduler.acquireRequest();
    clock.advance(1);
  }
  assert.equal(clock.timers.size, 0);
});

test('FIFO jobs share concurrency between moderate and aiModerate; overflow drops the newest', async () => {
  const requests = [];
  const iris = createIris({ keywords: ['命中'], ai: {
    apiKey: 'token', maxConcurrent: 1, maxQueueSize: 2,
    fetch: async (_url, init) => {
      const pending = deferred();
      requests.push({ input: JSON.parse(init.body).messages[0].content, ...pending });
      return pending.promise;
    },
  } });
  const first = iris.moderate('命中');
  const second = iris.aiModerate('second');
  const third = iris.aiModerate('third');
  const overflow = await iris.moderate('命中');
  await flush();
  assert.deepEqual(iris.getAIQueueStats(), { active: 1, queued: 2, maxConcurrent: 1, maxQueueSize: 2 });
  assert.equal(overflow.isIllegal, true);
  assert.equal(overflow.aiResult.status, 'dropped');
  assert.equal(overflow.aiResult.result, null);
  assert.equal(overflow.aiResult.error.code, 'QUEUE_FULL');
  assert.equal(overflow.needsReview, true);
  assert.deepEqual(requests.map(request => request.input), ['命中']);
  requests[0].resolve(reply());
  await first;
  await flush();
  assert.deepEqual(requests.map(request => request.input), ['命中', 'second']);
  requests[1].resolve(reply());
  await second;
  await flush();
  assert.equal(requests[2].input, 'third');
  requests[2].resolve(reply());
  await third;
  assert.equal(iris.getAIQueueStats().active, 0);
  assert.equal(iris.getAIQueueStats().queued, 0);
});

test('parallel reviewers respect maxConcurrent and a zero-length waiting queue', async () => {
  const pending = [];
  const iris = createIris({ ai: { apiKey: 'token', maxConcurrent: 2, maxQueueSize: 0,
    fetch: async () => { const request = deferred(); pending.push(request); return request.promise; },
  } });
  const first = iris.aiModerate('first');
  const second = iris.aiModerate('second');
  const third = await iris.aiModerate('third');
  await flush();
  assert.equal(third.status, 'dropped');
  assert.equal(pending.length, 2);
  assert.equal(iris.getAIQueueStats().active, 2);
  for (const request of pending) request.resolve(reply());
  await Promise.all([first, second]);
  assert.equal(iris.getAIQueueStats().active, 0);
});

test('cancelling a queued job frees capacity immediately and never submits it', async () => {
  const firstRequest = deferred();
  const calls = [];
  const iris = createIris({ ai: { apiKey: 'token', maxQueueSize: 1,
    fetch: async (_url, init) => {
      calls.push(JSON.parse(init.body).messages[0].content);
      return calls.length === 1 ? firstRequest.promise : reply();
    },
  } });
  const first = iris.aiModerate('first');
  const controller = new AbortController();
  const cancelled = iris.aiModerate('cancelled', { signal: controller.signal });
  controller.abort();
  assert.equal((await cancelled).error.code, 'ABORTED');
  assert.equal(iris.getAIQueueStats().queued, 0);
  const replacement = iris.aiModerate('replacement');
  await flush();
  firstRequest.resolve(reply());
  await Promise.all([first, replacement]);
  assert.deepEqual(calls, ['first', 'replacement']);
});

test('failed or timed-out work frees concurrency slots for the next queued job', async () => {
  for (const initial of ['network', 'timeout']) {
    let count = 0;
    const iris = createIris({ ai: { apiKey: 'token', timeoutMs: 15,
      fetch: async () => {
        if (count++) return reply();
        if (initial === 'network') throw new Error('network');
        return new Promise(() => {});
      },
    } });
    const [first, second] = await Promise.all([iris.aiModerate('first'), iris.aiModerate('second')]);
    assert.equal(first.status, 'error');
    assert.equal(second.status, 'completed');
    assert.equal(iris.getAIQueueStats().active, 0);
  }
});

test('separate source-only reviews each consume one rate-limit allowance', async () => {
  const starts = [];
  const iris = createIris({ ai: { apiKey: 'token', rateLimit: { maxRequests: 1, intervalMs: 35 },
    fetch: async () => { starts.push(performance.now()); return reply(); },
  } });
  await Promise.all([iris.aiModerate('Ａ-b'), iris.aiModerate('危-險詞')]);
  assert.equal(starts.length, 2);
  assert.ok(starts[1] - starts[0] >= 33, String(starts));
});

test('abort while waiting for a rate allowance never submits that review', async () => {
  const mock = mockFetch();
  const controller = new AbortController();
  const iris = createIris({ ai: { apiKey: 'token', fetch: mock.fetch, rateLimit: { maxRequests: 1, intervalMs: 60_000 } } });
  await iris.aiModerate('first');
  const pending = iris.aiModerate('Ａ-b', { signal: controller.signal });
  await flush();
  assert.equal(mock.calls.length, 1);
  controller.abort();
  const result = await pending;
  assert.equal(result.error.code, 'ABORTED');
  assert.equal(result.assessments.length, 0);
  assert.equal(mock.calls.length, 1);
  assert.equal(iris.getAIQueueStats().active, 0);
});

test('rate limiting is independent for different Iris instances', async () => {
  const options = { ai: { apiKey: 'token', rateLimit: { maxRequests: 1, intervalMs: 60_000 }, fetch: mockFetch().fetch } };
  const results = await Promise.all([createIris(options).aiModerate('one'), createIris(options).aiModerate('two')]);
  assert.deepEqual(results.map(result => result.status), ['completed', 'completed']);
});

test('clearing the shared queue settles every discarded review, preserves keyword hits and allows refilling', async () => {
  const firstRequest = deferred();
  const calls = [];
  const iris = createIris({ keywords: ['命中'], ai: { apiKey: 'token', maxQueueSize: 2,
    fetch: async (_url, init) => {
      calls.push(JSON.parse(init.body).messages[0].content);
      return calls.length === 1 ? firstRequest.promise : reply();
    },
  } });
  const active = iris.aiModerate('active');
  const combined = iris.moderate('命中');
  const controller = new AbortController();
  const queued = iris.aiModerate('discarded', { signal: controller.signal });
  await flush();
  assert.deepEqual(calls, ['active']);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 1);

  assert.equal(iris.clearAIQueue(), 2);
  assert.deepEqual(iris.getAIQueueStats(), { active: 1, queued: 0, maxConcurrent: 1, maxQueueSize: 2 });
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  assert.equal(iris.clearAIQueue(), 0);
  const [combinedResult, aiResult] = await Promise.all([combined, queued]);
  for (const result of [combinedResult.aiResult, aiResult]) {
    assert.equal(result.status, 'dropped');
    assert.equal(result.result, null);
    assert.equal(result.skipReason, 'queue-cleared');
    assert.equal(result.needsReview, true);
    assert.deepEqual(result.error, {
      code: 'QUEUE_CLEARED', message: 'AI 等待队列已清空，本次审核已放弃。', status: null, retryable: false,
    });
    assert.deepEqual(result.assessments, []);
  }
  assert.equal(combinedResult.keywordResult.hit, true);
  assert.equal(combinedResult.isIllegal, true);
  assert.equal(combinedResult.needsReview, true);
  controller.abort();
  const replacement = iris.aiModerate('replacement');
  assert.equal(iris.getAIQueueStats().queued, 1);
  firstRequest.resolve(reply());
  const completed = await Promise.all([active, replacement]);
  assert.deepEqual(completed.map(result => result.status), ['completed', 'completed']);
  assert.deepEqual(calls, ['active', 'replacement']);
  assert.equal(iris.getAIQueueStats().active, 0);
});

test('clearing before work starts retains active concurrency slots and never starts discarded jobs', async () => {
  const mock = mockFetch();
  const iris = createIris({ ai: { apiKey: 'token', fetch: mock.fetch, maxConcurrent: 2 } });
  const first = iris.aiModerate('first');
  const second = iris.aiModerate('second');
  const discarded = iris.aiModerate('discarded');
  assert.equal(iris.clearAIQueue(), 1);
  assert.equal(iris.getAIQueueStats().active, 2);
  assert.equal((await discarded).error.code, 'QUEUE_CLEARED');
  await Promise.all([first, second]);
  assert.deepEqual(mock.calls.map(call => call.body.messages[0].content), ['first', 'second']);
  assert.equal(iris.clearAIQueue(), 0);
  assert.equal(createIris().clearAIQueue(), 0);
});

test('clearing keeps active rate-limited reviews and their existing request quota', async () => {
  const clock = new ManualClock();
  const scheduler = new AIScheduler({ maxConcurrent: 1, maxQueueSize: 2, rateLimit: { maxRequests: 1, intervalMs: 100 } }, clock);
  const starts = [];
  const run = label => scheduler.run(async () => {
    await scheduler.acquireRequest();
    starts.push([label, clock.now()]);
  });
  await run('initial');
  const active = run('rate-limited');
  const discarded = assert.rejects(run('discarded'), { code: 'QUEUE_CLEARED' });
  await flush();
  assert.equal(clock.timers.size, 1);
  assert.equal(scheduler.clearQueue(), 1);
  await discarded;
  assert.equal(scheduler.stats.active, 1);
  assert.equal(scheduler.stats.queued, 0);
  assert.equal(clock.timers.size, 1);
  clock.advance(99);
  await flush();
  assert.deepEqual(starts, [['initial', 0]]);
  clock.advance(1);
  await active;
  assert.deepEqual(starts, [['initial', 0], ['rate-limited', 100]]);
  assert.equal(clock.timers.size, 0);
});
