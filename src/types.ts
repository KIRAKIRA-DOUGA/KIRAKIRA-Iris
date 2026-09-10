/** UTF-16 indices, with an exclusive end. */
export interface SourceSpan { start: number; end: number }

export interface NormalizedText {
  source: string;
  normalizeString: string;
  sourceMap: SourceSpan[];
}

export interface KeywordMatch {
  /** The original keyword supplied by the caller, before normalization. */
  hitWord: string;
  wordStartInSource: number;
  wordEndInSource: number;
  wordStartInNormalize: number;
  wordEndInNormalize: number;
}

export interface KeywordResult {
  hit: boolean;
  normalizeString: string;
  matchesInSource: KeywordMatch[];
  matchesInNormalize: KeywordMatch[];
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
  /** drop means no AI verdict, including skipped, cancelled and failed reviews. */
  status: 'pass' | 'block' | 'drop';
  comment: string;
  model: string;
  skipReason: 'not-configured' | 'empty-input' | 'no-keyword-hit' | 'queue-full' | 'queue-cleared' | null;
  error: AIErrorInfo | null;
}

export interface ModerationResult {
  /** A keyword hit cannot be cleared by any AI outcome. */
  hit: boolean;
  keywordResult: KeywordResult;
  aiResult: AIResult;
}

export interface AIRateLimit {
  /** Maximum outbound HTTP requests in any sliding interval. */
  maxRequests: number;
  /** Sliding counting window in milliseconds, not a fixed delay before each request. */
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
  /** OpenRouter model ID. Omit for the default safety model; response parsing is automatic. */
  model?: string;
  /** Advanced: override automatic response format selection. Usually omit. */
  protocol?: 'auto' | 'nemotron' | 'json';
  /** Per HTTP request, starting after rate-limit admission. Default 30,000ms. */
  timeoutMs?: number;
  maxTokens?: number;
  /** Default 20 requests per 60,000ms; shared by both AI-capable methods. */
  rateLimit?: AIRateLimit;
  /** Maximum simultaneous review jobs, including jobs waiting for rate allowance. Default 3. */
  maxConcurrent?: number;
  /** Waiting jobs excluding running jobs. Default 100; 0 disables waiting. */
  maxQueueSize?: number;
  /** Advanced: append application-specific moderation rules. JSON protocol only. */
  policy?: string;
  /** Advanced: opt-in JSON Schema for compatible JSON models. Usually omit. */
  structuredOutput?: boolean;
  /** Advanced: custom network transport for proxy integration or tests. Usually omit. */
  fetch?: typeof globalThis.fetch;
}

export interface IrisOptions {
  /** Compiled once at initialization; call refreshKeywords to replace it later. */
  keywords?: readonly string[];
  /** Maximum source.length in UTF-16 code units. Default 100,000. */
  maxInputLength?: number;
  /** 原文与其归一化文本一共最多可以匹配到的关键词数量，按命中次数累计。默认 10000。 */
  maxMatches?: number;
  /** Omit for keyword-only use. Configuring AI requires an explicit token. */
  ai?: AIOptions;
}

export interface ModerateOptions {
  /** Cancels queued, rate-limited and in-flight AI work. */
  signal?: AbortSignal;
}
