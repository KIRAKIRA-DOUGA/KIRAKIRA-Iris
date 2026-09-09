import { Automaton } from './automaton.js';
import { mapNormalizedRange, mapSourceRange, normalizeText } from './normalize.js';
import type { KeywordMatch, KeywordResult, KeywordRule, NormalizedText, Severity } from './types.js';

export const SEVERITY_RANK: Readonly<Record<Severity, number>> = Object.freeze({ general: 1, dangerous: 2, extreme: 3 });
export const SEVERITY_LABEL: Readonly<Record<Severity, string>> = Object.freeze({ general: '一般', dangerous: '危险', extreme: '极度危险' });

export function validateSeverity(value: unknown): asserts value is Severity {
  if (value !== 'general' && value !== 'dangerous' && value !== 'extreme') {
    throw new TypeError('Severity must be general, dangerous or extreme.');
  }
}

export class KeywordMatcher {
  private readonly rules: KeywordRule[];
  private readonly sourceMatcher: Automaton;
  private readonly normalizedMatcher: Automaton;
  readonly size: number;

  constructor(rules: readonly KeywordRule[]) {
    if (!Array.isArray(rules)) throw new TypeError('keywords must be an array.');
    this.rules = rules.map(rule => {
      if (!rule || typeof rule.word !== 'string' || !rule.word.trim()) throw new TypeError('Each keyword needs a nonempty word.');
      validateSeverity(rule.severity);
      for (const key of ['id', 'category', 'comment'] as const) {
        if (rule[key] !== undefined && typeof rule[key] !== 'string') throw new TypeError(`Keyword ${key} must be a string.`);
      }
      return { ...rule };
    });
    this.size = this.rules.length;
    this.sourceMatcher = new Automaton(this.rules.map(rule => rule.word));
    this.normalizedMatcher = new Automaton(this.rules.map(rule => normalizeText(rule.word).normalizeString));
  }

  check(text: NormalizedText, enabled: boolean, blockSeverity: Severity, maxMatches: number): KeywordResult {
    const found = new Map<string, KeywordMatch>();
    const add = (ruleIndex: number, start: number, end: number, matchedIn: 'source' | 'normalized'): void => {
      const source = matchedIn === 'source' ? { start, end } : mapNormalizedRange(text, start, end);
      const normalized = matchedIn === 'normalized' ? { start, end } : mapSourceRange(text, start, end);
      const key = `${ruleIndex}:${source.start}:${source.end}:${normalized.start}:${normalized.end}`;
      const existing = found.get(key);
      if (existing) {
        if (!existing.matchedIn.includes(matchedIn)) existing.matchedIn.push(matchedIn);
        return;
      }
      if (found.size >= maxMatches) throw new RangeError(`Keyword matches exceed maxMatches (${maxMatches}).`);
      const rule = this.rules[ruleIndex]!;
      found.set(key, {
        ruleIndex, id: rule.id ?? null, hitWord: rule.word, hiteWord: rule.word,
        severity: rule.severity, category: rule.category ?? null,
        comment: rule.comment ?? `命中${SEVERITY_LABEL[rule.severity]}关键词“${rule.word}”。`,
        matchedIn: [matchedIn], sourceText: text.source.slice(source.start, source.end),
        normalizedText: normalized.start < 0 ? '' : text.normalizeString.slice(normalized.start, normalized.end),
        wordStartInSource: source.start, wordEndInSource: source.end,
        wordStartInNormalize: normalized.start, wordEndInNormalize: normalized.end,
      });
    };
    if (enabled) {
      this.sourceMatcher.scan(text.source, (rule, start, end) => add(rule, start, end, 'source'));
      this.normalizedMatcher.scan(text.normalizeString, (rule, start, end) => add(rule, start, end, 'normalized'));
    }
    const matches = [...found.values()].sort((a, b) => a.wordStartInSource - b.wordStartInSource
      || a.wordEndInSource - b.wordEndInSource || a.ruleIndex - b.ruleIndex
      || a.wordStartInNormalize - b.wordStartInNormalize);
    const primary = matches.reduce<KeywordMatch | undefined>((best, match) =>
      !best || SEVERITY_RANK[match.severity] > SEVERITY_RANK[best.severity] ? match : best, undefined);
    return {
      enabled, status: enabled ? 'completed' : 'disabled', hit: !!primary, hite: !!primary,
      hitWord: primary?.hitWord ?? null, hiteWord: primary?.hitWord ?? null,
      isIllegal: !!primary && SEVERITY_RANK[primary.severity] >= SEVERITY_RANK[blockSeverity],
      severity: primary?.severity ?? null,
      comment: !enabled ? '关键词过滤已关闭。' : primary?.comment ?? '未命中关键词。',
      normalizeString: text.normalizeString,
      wordStartInSource: primary?.wordStartInSource ?? -1, wordEndInSource: primary?.wordEndInSource ?? -1,
      wordStartInNormalize: primary?.wordStartInNormalize ?? -1, wordEndInNormalize: primary?.wordEndInNormalize ?? -1,
      matches,
    };
  }
}
