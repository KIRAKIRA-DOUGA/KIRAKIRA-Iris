/** Ascending risk levels: 一般、危险、极度危险. */
export type Severity = 'general' | 'dangerous' | 'extreme';

export interface KeywordRule {
  word: string;
  severity: Severity;
  comment?: string;
  id?: string;
  category?: string;
}

/** All offsets use JavaScript UTF-16 indices; end is exclusive. */
export interface SourceSpan {
  start: number;
  end: number;
}

export interface NormalizedText {
  source: string;
  normalizeString: string;
  /** One source span for each UTF-16 code unit of normalizeString. */
  sourceMap: SourceSpan[];
}

export interface KeywordMatch {
  ruleIndex: number;
  id: string | null;
  hitWord: string;
  /** Compatibility alias for hitWord. */
  hiteWord: string;
  severity: Severity;
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
  enabled: boolean;
  status: 'completed' | 'disabled';
  hit: boolean;
  /** Compatibility alias for hit. */
  hite: boolean;
  /** Highest-severity match; source order breaks ties. */
  hitWord: string | null;
  hiteWord: string | null;
  isIllegal: boolean;
  severity: Severity | null;
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
  input: 'source' | 'normalized';
  model: string;
  requestId: string | null;
}

export type AIErrorCode = 'MISSING_API_KEY' | 'HTTP_ERROR' | 'API_ERROR'
  | 'INVALID_RESPONSE' | 'TIMEOUT' | 'ABORTED' | 'NETWORK_ERROR';

export interface AIErrorInfo {
  code: AIErrorCode;
  message: string;
  status: number | null;
  retryable: boolean;
}

export interface AIResult {
  enabled: boolean;
  status: 'completed' | 'skipped' | 'disabled' | 'error';
  /** null means no complete AI verdict, never a safe verdict. */
  result: boolean | null;
  comment: string;
  model: string;
  categories: string[];
  assessments: AIAssessment[];
  skipReason: 'disabled' | 'below-threshold' | 'empty-input' | null;
  error: AIErrorInfo | null;
}

export interface ModerationResult {
  /** Application policy decision; not a legal determination. */
  isIllegal: boolean;
  needsReview: boolean;
  decisionSource: 'ai' | 'keyword' | 'combined' | 'error-policy' | 'none';
  keywordResult: KeywordResult;
  aiResult: AIResult;
}

export interface AIOptions {
  /** Falls back to OPENROUTER_API_KEY; only read when a review is needed. */
  apiKey?: string;
  model?: string;
  /** auto selects Nemotron's native labels for NVIDIA content-safety models. */
  protocol?: 'auto' | 'nemotron' | 'json';
  /** Default: keyword. If keywords are disabled or empty, reviews all input. */
  trigger?: 'keyword' | 'always';
  minSeverity?: Severity;
  /** Review normalized input in addition to the source, if different. Default true. */
  reviewNormalized?: boolean;
  /** Per request timeout, including reading the response body. Default 30,000ms. */
  timeoutMs?: number;
  maxTokens?: number;
  /** Default block. keyword-only still sets needsReview on errors. */
  onError?: 'block' | 'keyword-only' | 'throw';
  /** Added to the system instructions for JSON protocol only. */
  policy?: string;
  /** Optional structured JSON enforcement; must be supported by the selected model. */
  structuredOutput?: boolean;
  /** Injectable transport for tests. The destination is always OpenRouter. */
  fetch?: typeof globalThis.fetch;
}

export interface IrisOptions {
  /** No built-in production blacklist. Supply your application's rules. */
  keywords?: readonly KeywordRule[];
  keywordFilter?: boolean;
  aiFilter?: boolean;
  blockSeverity?: Severity;
  /** AI can clear a keyword hit by default; any rejects if either dimension rejects. */
  decisionMode?: 'ai-priority' | 'any';
  maxInputLength?: number;
  maxMatches?: number;
  ai?: AIOptions;
}

export interface ModerateOptions {
  keywordFilter?: boolean;
  aiFilter?: boolean;
  signal?: AbortSignal;
}
