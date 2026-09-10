import { emptyAIResult, failedAIResult, resolveProtocol, reviewWithOpenRouter } from './ai.js';
import { IrisAIError } from './errors.js';
import { KeywordMatcher } from './keywords.js';
import { normalizeText } from './normalize.js';
import { AIScheduler } from './scheduler.js';
import type { AIOptions, AIQueueStats, AIResult, IrisOptions, KeywordResult, ModerateOptions, ModerationResult, NormalizedText } from './types.js';

function integer(value: number | undefined, name: string, minimum = 1): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < minimum || value > 2_147_483_647)) {
    throw new RangeError(`${name} must be an integer between ${minimum} and 2147483647.`);
  }
}

function booleanOption(value: boolean | undefined, name: string): void {
  if (value !== undefined && typeof value !== 'boolean') throw new TypeError(`${name} must be a boolean.`);
}

export class Iris {
  private readonly ai: AIOptions | undefined;
  private matcher: KeywordMatcher;
  private readonly scheduler: AIScheduler;
  private readonly maxInputLength: number;
  private readonly maxMatches: number;

  constructor(options: IrisOptions = {}) {
    for (const key of ['keywordFilter', 'aiFilter', 'blockSeverity', 'decisionMode']) {
      if (key in options) throw new TypeError(`${key} was removed; use keywordModerate, aiModerate or moderate.`);
    }
    for (const key of ['maxInputLength', 'maxMatches'] as const) integer(options[key], key);
    this.maxInputLength = options.maxInputLength ?? 100_000;
    this.maxMatches = options.maxMatches ?? 10_000;
    if (options.ai) {
      const ai = options.ai;
      if (typeof ai.apiKey !== 'string' || !ai.apiKey.trim()) throw new TypeError('ai.apiKey must be a nonempty token string.');
      for (const key of ['trigger', 'minSeverity', 'onError', 'reviewNormalized']) {
        if (key in ai) throw new TypeError(`ai.${key} was removed.`);
      }
      booleanOption(ai.structuredOutput, 'ai.structuredOutput');
      for (const key of ['timeoutMs', 'maxTokens', 'maxConcurrent'] as const) integer(ai[key], `ai.${key}`);
      integer(ai.maxQueueSize, 'ai.maxQueueSize', 0);
      if (ai.rateLimit !== undefined) {
        if (!ai.rateLimit || typeof ai.rateLimit.maxRequests !== 'number' || typeof ai.rateLimit.intervalMs !== 'number') {
          throw new TypeError('ai.rateLimit requires maxRequests and intervalMs.');
        }
        integer(ai.rateLimit.maxRequests, 'ai.rateLimit.maxRequests');
        integer(ai.rateLimit.intervalMs, 'ai.rateLimit.intervalMs');
      }
      if (ai.protocol !== undefined && !['auto', 'nemotron', 'json'].includes(ai.protocol)) throw new TypeError('Invalid ai.protocol.');
      for (const key of ['model', 'policy'] as const) {
        if (ai[key] !== undefined && typeof ai[key] !== 'string') throw new TypeError(`ai.${key} must be a string.`);
      }
      if (ai.model !== undefined && !ai.model.trim()) throw new TypeError('ai.model must not be empty.');
      if (ai.fetch !== undefined && typeof ai.fetch !== 'function') throw new TypeError('ai.fetch must be a function.');
      if (resolveProtocol(ai) === 'nemotron' && (ai.policy || ai.structuredOutput)) {
        throw new TypeError('Custom policy and structuredOutput require ai.protocol="json" and a compatible model.');
      }
      this.ai = { ...ai, ...(ai.rateLimit ? { rateLimit: { ...ai.rateLimit } } : {}) };
    }
    this.matcher = new KeywordMatcher(options.keywords ?? []);
    this.scheduler = new AIScheduler({
      maxConcurrent: this.ai?.maxConcurrent ?? 3,
      maxQueueSize: this.ai?.maxQueueSize ?? 100,
      rateLimit: this.ai?.rateLimit ?? { maxRequests: 20, intervalMs: 60_000 },
    });
  }

  private validateInput(input: string): void {
    if (typeof input !== 'string') throw new TypeError('Input must be a string.');
    if (input.length > this.maxInputLength) throw new RangeError(`Input exceeds maxInputLength (${this.maxInputLength} UTF-16 units).`);
  }

  private normalize(input: string): NormalizedText {
    this.validateInput(input);
    return normalizeText(input);
  }

  private async review(source: string, signal?: AbortSignal) {
    const ai = this.ai;
    if (!ai) return failedAIResult(undefined, new IrisAIError('MISSING_API_KEY', '请通过 ai.apiKey 传入 token 字符串。'));
    try {
      return await this.scheduler.run(
        () => reviewWithOpenRouter(source, ai, signal, () => this.scheduler.acquireRequest(signal)), signal,
      );
    } catch (error) {
      return failedAIResult(ai, error);
    }
  }

  /**
   * Replace the entire dictionary. Compile before swapping so invalid input
   * leaves the current dictionary intact. Pending AI reviews keep their keyword results.
   */
  refreshKeywords(keywords: readonly string[]): void {
    const next = new KeywordMatcher(keywords);
    this.matcher = next;
  }

  /** Synchronous and local. Returns independent source and normalized matches. */
  keywordModerate(input: string): KeywordResult {
    return this.matcher.check(this.normalize(input), this.maxMatches);
  }

  /** AI only. Does not consult the keyword matcher. */
  async aiModerate(input: string, options: ModerateOptions = {}): Promise<AIResult> {
    this.validateInput(input);
    if (!input.trim()) return emptyAIResult(this.ai, 'empty-input');
    return this.review(input, options.signal);
  }

  /** Always check keywords; only hits trigger optional AI, which cannot clear a keyword hit. */
  async moderate(input: string, options: ModerateOptions = {}): Promise<ModerationResult> {
    for (const key of ['keywordFilter', 'aiFilter']) {
      if (key in options) throw new TypeError(`${key} was removed; choose the appropriate moderation method.`);
    }
    const text = this.normalize(input);
    const keywordResult = this.matcher.check(text, this.maxMatches);
    const aiResult = !this.ai ? emptyAIResult(undefined, 'not-configured')
      : !input.trim() ? emptyAIResult(this.ai, 'empty-input')
      : !keywordResult.hit ? emptyAIResult(this.ai, 'no-keyword-hit')
      : await this.review(input, options.signal);
    return {
      hit: keywordResult.hit || aiResult.status === 'block', keywordResult, aiResult,
    };
  }

  getAIQueueStats(): AIQueueStats {
    return this.scheduler.stats;
  }

  /** Drop waiting AI reviews; returns the count. Active reviews and rate limits are retained. */
  clearAIQueue(): number {
    return this.scheduler.clearQueue();
  }
}

export function createIris(options: IrisOptions = {}): Iris {
  return new Iris(options);
}
