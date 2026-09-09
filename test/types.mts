import { createIris, type ModerationResult, type KeywordRule } from 'kirakira-iris';

const keywords = [{ word: 'example', severity: 'dangerous' }] satisfies KeywordRule[];
const result: ModerationResult = await createIris({ keywords, aiFilter: false }).moderate('example');
const verdict: boolean | null = result.aiResult.result;
void verdict;
// @ts-expect-error Unknown severities are rejected by TypeScript.
createIris({ keywords: [{ word: 'x', severity: 'unknown' }] });
