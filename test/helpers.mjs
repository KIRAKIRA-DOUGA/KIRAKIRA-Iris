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

export const rules = [
  { word: '提醒', severity: 'general', comment: '一般提示' },
  { word: '危险词', severity: 'dangerous', comment: '需要结合上下文复核' },
  { word: '极危词', severity: 'extreme', category: 'test', id: 'extreme-1' },
];
