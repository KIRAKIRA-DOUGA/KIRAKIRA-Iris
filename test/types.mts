import { createIris, type ModerationResult, type Keyword, type KeywordResult, type AIResult } from 'kirakira-iris';

const keywords: Keyword[] = ['example', { word: '示例', comment: '提示' }];
const iris = createIris({ keywords, ai: { apiKey: 'explicit-token', rateLimit: { maxRequests: 20, intervalMs: 60_000 }, maxQueueSize: 100 } });
const both: ModerationResult = await iris.moderate('example');
const keyword: KeywordResult = iris.keywordModerate('example');
const ai: AIResult = await iris.aiModerate('example');
void [both, keyword, ai];
const refreshedWords: string[] = ['新的关键词'];
iris.refreshKeywords(refreshedWords);
iris.refreshKeywords(['只读关键词'] as const);
iris.refreshKeywords([{ word: 'metadata', comment: 'updated' }]);
// @ts-expect-error Refresh requires an array, not a single string.
iris.refreshKeywords('invalid');
// @ts-expect-error Severity no longer exists.
createIris({ keywords: [{ word: 'x', severity: 'general' }] });
// @ts-expect-error Keyword filtering cannot be disabled.
createIris({ keywordFilter: false });
// @ts-expect-error An explicit token is required when AI is configured.
createIris({ ai: {} });
// @ts-expect-error AI cannot clear a keyword hit.
createIris({ decisionMode: 'ai-priority' });
// @ts-expect-error Select a method rather than disabling keyword filtering.
iris.moderate('x', { keywordFilter: false });
// @ts-expect-error AI always reviews the source, never normalized text.
createIris({ ai: { apiKey: 'explicit-token', reviewNormalized: true } });
