export { Iris, createIris } from './iris.js';
export { DEFAULT_AI_MODEL, OPENROUTER_URL, IrisAIError, parseAIResponse } from './ai.js';
export { normalizeText, mapNormalizedRange, mapSourceRange } from './normalize.js';
export { SEVERITY_LABEL, SEVERITY_RANK } from './keywords.js';
export type {
  Severity, KeywordRule, SourceSpan, NormalizedText, KeywordMatch, KeywordResult,
  ParsedAIResult, AIAssessment, AIErrorCode, AIErrorInfo, AIResult, ModerationResult,
  AIOptions, IrisOptions, ModerateOptions,
} from './types.js';
