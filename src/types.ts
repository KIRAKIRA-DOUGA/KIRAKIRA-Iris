export interface KeywordRule {
  word: string;
  comment?: string;
  id?: string;
  category?: string;
}

/** Caller-supplied strings or metadata-bearing rules. No built-in blacklist. */
export type Keyword = string | KeywordRule;

/** UTF-16 indices, with an exclusive end. */
export interface SourceSpan { start: number; end: number }

export interface NormalizedText {
  source: string;
  normalizeString: string;
  sourceMap: SourceSpan[];
}

export interface KeywordMatch {
  ruleIndex: number;
  id: string | null;
  hitWord: string;
  /** Compatibility alias for hitWord. */
  hiteWord: string;
  category: string | null;
  comment: string;
  matchedIn: Array<'source' | 'normalized'>;
  sourceText: string;
  normalizedText: string;
  wordStartInSource: number;
  wordEndInSource: number;
  wordStartInNormalize: number;
  wordEndInNormalize: number;
}

export interface KeywordResult {
  status: 'completed';
  hit: boolean;
  /** Compatibility alias for hit. */
  hite: boolean;
  /** First match in source order. */
  hitWord: string | null;
  hiteWord: string | null;
  /** Always equal to hit. */
  isIllegal: boolean;
  comment: string;
  normalizeString: string;
  wordStartInSource: number;
  wordEndInSource: number;
  wordStartInNormalize: number;
  wordEndInNormalize: number;
  matches: KeywordMatch[];
}

export interface ParsedAIResult {
  /** true means unsafe / violates the moderation policy. */
  result: boolean;
  comment: string;
  categories: string[];
}

export interface AIAssessment extends ParsedAIResult {
  input: 'source';
  model: string;
  requestId: string | null;
}

export type AIErrorCode = 'MISSING_API_KEY' | 'HTTP_ERROR' | 'API_ERROR'
  | 'INVALID_RESPONSE' | 'TIMEOUT' | 'ABORTED' | 'NETWORK_ERROR' | 'QUEUE_FULL' | 'QUEUE_CLEARED';

export interface AIErrorInfo {
  code: AIErrorCode;
  message: string;
  status: number | null;
  retryable: boolean;
}

export interface AIResult {
  status: 'completed' | 'skipped' | 'disabled' | 'error' | 'dropped';
  /** null means no complete AI verdict, never a safe verdict. */
  result: boolean | null;
  needsReview: boolean;
  comment: string;
  model: string;
  categories: string[];
  assessments: AIAssessment[];
  skipReason: 'not-configured' | 'empty-input' | 'no-keyword-hit' | 'queue-full' | 'queue-cleared' | null;
  error: AIErrorInfo | null;
}

export interface ModerationResult {
  /** A keyword hit cannot be cleared by any AI outcome. */
  isIllegal: boolean;
  needsReview: boolean;
  keywordResult: KeywordResult;
  aiResult: AIResult;
}

export interface AIRateLimit {
  /** Maximum outbound HTTP requests in any sliding interval. */
  maxRequests: number;
  intervalMs: number;
}

export interface AIQueueStats {
  /** Running reviews, including reviews waiting for their next request allowance. */
  active: number;
  /** FIFO jobs waiting for a concurrency slot. */
  queued: number;
  maxConcurrent: number;
  maxQueueSize: number;
}

export interface AIOptions {
  /** Required explicit token string. Never read from the environment. */
  apiKey: string;
  model?: string;
  protocol?: 'auto' | 'nemotron' | 'json';
  /** Per HTTP request, starting after rate-limit admission. Default 30,000ms. */
  timeoutMs?: number;
  maxTokens?: number;
  /** Default 20 requests per 60,000ms; shared by both AI-capable methods. */
  rateLimit?: AIRateLimit;
  /** Running review jobs per Iris instance. Default 1. */
  maxConcurrent?: number;
  /** Waiting jobs excluding running jobs. Default 100; 0 disables waiting. */
  maxQueueSize?: number;
  /** JSON protocol only. */
  policy?: string;
  /** Opt-in JSON Schema for compatible JSON models. */
  structuredOutput?: boolean;
  fetch?: typeof globalThis.fetch;
}

export interface IrisOptions {
  /** Compiled once at initialization; call refreshKeywords to replace it later. */
  keywords?: readonly Keyword[];
  maxInputLength?: number;
  maxMatches?: number;
  /** Omit for keyword-only use. Configuring AI requires an explicit token. */
  ai?: AIOptions;
}

export interface ModerateOptions {
  /** Cancels queued, rate-limited and in-flight AI work. */
  signal?: AbortSignal;
}
