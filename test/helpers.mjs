export function reply(content = 'User Safety: safe', extra = {}) {
  return new Response(JSON.stringify({
    id: 'test-request', model: 'test-model',
    choices: [{ finish_reason: 'stop', message: { content } }], ...extra,
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

export function mockFetch(...responses) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, ...init, body: JSON.parse(init.body) });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next ?? reply();
  };
  return { fetch, calls };
}

export async function flush() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
