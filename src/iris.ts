import { emptyAIResult, IrisAIError, resolveProtocol, reviewWithOpenRouter } from './ai.js';
import { KeywordMatcher, SEVERITY_RANK, validateSeverity } from './keywords.js';
import { normalizeText } from './normalize.js';
import type { AIOptions, IrisOptions, KeywordResult, ModerateOptions, ModerationResult } from './types.js';

function positiveInteger(value: number | undefined, name: string): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647)) {
    throw new RangeError(`${name} must be a positive integer <= 2147483647.`);
  }
}

function booleanOption(value: boolean | undefined, name: string): void {
  if (value !== undefined && typeof value !== 'boolean') throw new TypeError(`${name} must be a boolean.`);
}

function choice(value: string | undefined, values: readonly string[], name: string): void {
  if (value !== undefined && !values.includes(value)) throw new TypeError(`Invalid ${name}.`);
}

export class Iris {
  private readonly options: IrisOptions;
  private readonly ai: AIOptions;
  private readonly matcher: KeywordMatcher;

  constructor(options: IrisOptions = {}) {
    this.options = { ...options };
    this.ai = { ...options.ai };
    this.matcher = new KeywordMatcher(options.keywords ?? []);
    for (const key of ['keywordFilter', 'aiFilter'] as const) booleanOption(options[key], key);
    for (const key of ['reviewNormalized', 'structuredOutput'] as const) booleanOption(this.ai[key], `ai.${key}`);
    for (const key of ['maxInputLength', 'maxMatches'] as const) positiveInteger(options[key], key);
    for (const key of ['timeoutMs', 'maxTokens'] as const) positiveInteger(this.ai[key], `ai.${key}`);
    validateSeverity(options.blockSeverity ?? 'dangerous');
    validateSeverity(this.ai.minSeverity ?? 'dangerous');
    choice(options.decisionMode, ['ai-priority', 'any'], 'decisionMode');
    choice(this.ai.trigger, ['keyword', 'always'], 'ai.trigger');
    choice(this.ai.protocol, ['auto', 'nemotron', 'json'], 'ai.protocol');
    choice(this.ai.onError, ['block', 'keyword-only', 'throw'], 'ai.onError');
    for (const key of ['apiKey', 'model', 'policy'] as const) {
      if (this.ai[key] !== undefined && typeof this.ai[key] !== 'string') throw new TypeError(`ai.${key} must be a string.`);
    }
    if (this.ai.model !== undefined && !this.ai.model.trim()) throw new TypeError('ai.model must not be empty.');
    if (this.ai.fetch !== undefined && typeof this.ai.fetch !== 'function') throw new TypeError('ai.fetch must be a function.');
    if (resolveProtocol(this.ai) === 'nemotron' && (this.ai.policy || this.ai.structuredOutput)) {
      throw new TypeError('Custom policy and structuredOutput require ai.protocol="json" and a compatible model.');
    }
  }

  private normalize(input: string) {
    if (typeof input !== 'string') throw new TypeError('Input must be a string.');
    const limit = this.options.maxInputLength ?? 100_000;
    if (input.length > limit) throw new RangeError(`Input exceeds maxInputLength (${limit} UTF-16 units).`);
    return normalizeText(input);
  }

  /** Synchronous keyword-only inspection. Never contacts OpenRouter. */
  checkKeywords(input: string): KeywordResult {
    return this.matcher.check(this.normalize(input), this.options.keywordFilter ?? true,
      this.options.blockSeverity ?? 'dangerous', this.options.maxMatches ?? 10_000);
  }

  async moderate(input: string, overrides: ModerateOptions = {}): Promise<ModerationResult> {
    booleanOption(overrides.keywordFilter, 'keywordFilter');
    booleanOption(overrides.aiFilter, 'aiFilter');
    const keywordEnabled = overrides.keywordFilter ?? this.options.keywordFilter ?? true;
    const aiEnabled = overrides.aiFilter ?? this.options.aiFilter ?? true;
    const text = this.normalize(input);
    const keywordResult = this.matcher.check(text, keywordEnabled,
      this.options.blockSeverity ?? 'dangerous', this.options.maxMatches ?? 10_000);
    const reachedThreshold = !!keywordResult.severity
      && SEVERITY_RANK[keywordResult.severity] >= SEVERITY_RANK[this.ai.minSeverity ?? 'dangerous'];
    const shouldReview = aiEnabled && !!input.trim() && (
      this.ai.trigger === 'always' || !keywordEnabled || this.matcher.size === 0 || reachedThreshold
    );
    const aiResult = shouldReview
      ? await reviewWithOpenRouter(text, this.ai, overrides.signal)
      : emptyAIResult(aiEnabled, this.ai, !aiEnabled ? 'disabled' : !input.trim() ? 'empty-input' : 'below-threshold');

    if (aiResult.error) {
      if (this.ai.onError === 'throw') {
        const { code, message, status, retryable } = aiResult.error;
        throw new IrisAIError(code, message, status, retryable);
      }
      // Keep any already-confirmed unsafe result even if a later variant fails.
      const confirmedUnsafe = aiResult.assessments.some(assessment => assessment.result);
      return {
        isIllegal: this.ai.onError !== 'keyword-only' || keywordResult.isIllegal || confirmedUnsafe,
        needsReview: true, decisionSource: 'error-policy', keywordResult, aiResult,
      };
    }
    const completed = aiResult.status === 'completed';
    const anyMode = this.options.decisionMode === 'any';
    return {
      isIllegal: completed ? (anyMode ? keywordResult.isIllegal || aiResult.result === true : aiResult.result === true) : keywordResult.isIllegal,
      needsReview: false,
      decisionSource: completed ? (anyMode && keywordEnabled ? 'combined' : 'ai') : keywordEnabled ? 'keyword' : 'none',
      keywordResult, aiResult,
    };
  }
}

export function createIris(options: IrisOptions = {}): Iris {
  return new Iris(options);
}
