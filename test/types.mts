import { createIris, type ModerationResult, type KeywordResult, type AIResult } from 'kirakira-iris';

const keywords: string[] = ['example', '示例'];
const iris = createIris({ keywords, ai: { apiKey: 'explicit-token', rateLimit: { maxRequests: 20, intervalMs: 60_000 }, maxQueueSize: 100 } });
const both: ModerationResult = await iris.moderate('example');
const keyword: KeywordResult = iris.keywordModerate('example');
const ai: AIResult = await iris.aiModerate('example');
const cleared: number = iris.clearAIQueue();
void [both, keyword, ai, cleared];
const refreshedWords: string[] = ['新的关键词'];
iris.refreshKeywords(refreshedWords);
iris.refreshKeywords(['只读关键词'] as const);
// @ts-expect-error Object keywords are not supported during refresh.
iris.refreshKeywords([{ word: 'metadata' }]);
// @ts-expect-error Refresh requires an array, not a single string.
iris.refreshKeywords('invalid');
// @ts-expect-error Object keywords are not supported during initialization.
createIris({ keywords: [{ word: 'x' }] });
// @ts-expect-error Removed typo alias.
keyword.hite;
// @ts-expect-error Removed non-neutral field.
both.isIllegal;
// @ts-expect-error Matches are separated by input dimension.
keyword.matches;
// @ts-expect-error AI uses a three-state status instead of a nullable boolean.
ai.result;
// @ts-expect-error No redundant per-input assessment list.
ai.assessments;
const status: 'pass' | 'block' | 'drop' = ai.status;
const hitWord: string | undefined = keyword.matchesInNormalize[0]?.hitWord;
void [status, hitWord];
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
