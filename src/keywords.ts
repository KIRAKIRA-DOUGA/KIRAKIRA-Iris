import { Automaton } from './automaton.js';
import { mapNormalizedRange, mapSourceRange, normalizeText } from './normalize.js';
import type { Keyword, KeywordMatch, KeywordResult, KeywordRule, NormalizedText } from './types.js';

export class KeywordMatcher {
  private readonly rules: KeywordRule[];
  private readonly sourceMatcher: Automaton;
  private readonly normalizedMatcher: Automaton;

  constructor(keywords: readonly Keyword[]) {
    if (!Array.isArray(keywords)) throw new TypeError('keywords must be an array.');
    this.rules = keywords.map(keyword => {
      const rule = typeof keyword === 'string' ? { word: keyword } : keyword;
      if (!rule || typeof rule.word !== 'string' || !rule.word.trim()) throw new TypeError('Each keyword needs a nonempty word.');
      if ('severity' in rule) throw new TypeError('Keyword severity was removed; all keyword hits are illegal.');
      for (const key of ['id', 'category', 'comment'] as const) {
        if (rule[key] !== undefined && typeof rule[key] !== 'string') throw new TypeError(`Keyword ${key} must be a string.`);
      }
      return { ...rule };
    });
    const words = this.rules.map(rule => rule.word);
    const normalized = words.map(word => normalizeText(word).normalizeString);
    this.sourceMatcher = new Automaton(words);
    this.normalizedMatcher = words.every((word, index) => word === normalized[index])
      ? this.sourceMatcher : new Automaton(normalized);
  }

  check(text: NormalizedText, maxMatches: number): KeywordResult {
    const found = new Map<string, KeywordMatch>();
    const add = (ruleIndex: number, start: number, end: number, matchedIn: 'source' | 'normalized'): void => {
      const source = matchedIn === 'source' ? { start, end } : mapNormalizedRange(text, start, end);
      const normalized = matchedIn === 'normalized' ? { start, end } : mapSourceRange(text, start, end);
      const key = `${ruleIndex}:${source.start}:${source.end}:${normalized.start}:${normalized.end}`;
      const existing = found.get(key);
      if (existing) {
        if (!existing.matchedIn.includes(matchedIn)) {
          if (matchedIn === 'source') existing.matchedIn.unshift(matchedIn);
          else existing.matchedIn.push(matchedIn);
        }
        return;
      }
      if (found.size >= maxMatches) throw new RangeError(`Keyword matches exceed maxMatches (${maxMatches}).`);
      const rule = this.rules[ruleIndex]!;
      found.set(key, {
        ruleIndex, id: rule.id ?? null, hitWord: rule.word, hiteWord: rule.word,
        category: rule.category ?? null, comment: rule.comment ?? `命中关键词“${rule.word}”。`,
        matchedIn: [matchedIn], sourceText: text.source.slice(source.start, source.end),
        normalizedText: normalized.start < 0 ? '' : text.normalizeString.slice(normalized.start, normalized.end),
        wordStartInSource: source.start, wordEndInSource: source.end,
        wordStartInNormalize: normalized.start, wordEndInNormalize: normalized.end,
      });
    };
    if (this.sourceMatcher === this.normalizedMatcher && text.source === text.normalizeString) {
      // Identical dictionaries and input can share a scan, but mappings may still
      // differ for multi-code-unit graphemes; project each dimension separately.
      this.sourceMatcher.scan(text.source, (rule, start, end) => {
        add(rule, start, end, 'source');
        add(rule, start, end, 'normalized');
      });
    } else {
      this.sourceMatcher.scan(text.source, (rule, start, end) => add(rule, start, end, 'source'));
      this.normalizedMatcher.scan(text.normalizeString, (rule, start, end) => add(rule, start, end, 'normalized'));
    }
    const matches = [...found.values()].sort((a, b) => a.wordStartInSource - b.wordStartInSource
      || a.wordEndInSource - b.wordEndInSource || a.ruleIndex - b.ruleIndex
      || a.wordStartInNormalize - b.wordStartInNormalize);
    const primary = matches[0];
    return {
      status: 'completed', hit: !!primary, hite: !!primary,
      hitWord: primary?.hitWord ?? null, hiteWord: primary?.hitWord ?? null,
      isIllegal: !!primary, comment: primary?.comment ?? '未命中关键词。',
      normalizeString: text.normalizeString,
      wordStartInSource: primary?.wordStartInSource ?? -1, wordEndInSource: primary?.wordEndInSource ?? -1,
      wordStartInNormalize: primary?.wordStartInNormalize ?? -1, wordEndInNormalize: primary?.wordEndInNormalize ?? -1,
      matches,
    };
  }
}
