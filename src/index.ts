export { Iris, createIris } from './iris.js';
export { DEFAULT_AI_MODEL, OPENROUTER_URL, parseAIResponse } from './ai.js';
export { IrisAIError } from './errors.js';
export { normalizeText, mapNormalizedRange, mapSourceRange } from './normalize.js';
export type {
  Keyword, KeywordRule, SourceSpan, NormalizedText, KeywordMatch, KeywordResult,
  ParsedAIResult, AIAssessment, AIErrorCode, AIErrorInfo, AIResult, ModerationResult,
  AIOptions, AIRateLimit, AIQueueStats, IrisOptions, ModerateOptions,
} from './types.js';
