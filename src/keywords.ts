import { Automaton } from './automaton.js';
import { mapNormalizedRange, mapSourceRange, normalizeText } from './normalize.js';
import type { KeywordMatch, KeywordResult, NormalizedText } from './types.js';

export class KeywordMatcher {
  private readonly words: string[];
  private readonly sourceMatcher: Automaton;
  private readonly normalizedMatcher: Automaton;

  constructor(keywords: readonly string[]) {
    if (!Array.isArray(keywords)) throw new TypeError('keywords must be a string array.');
    this.words = Array.from(keywords, word => {
      if (typeof word !== 'string' || !word.trim()) throw new TypeError('Each keyword must be a nonempty string.');
      return word;
    });
    const normalized = this.words.map(word => normalizeText(word).normalizeString);
    this.sourceMatcher = new Automaton(this.words);
    this.normalizedMatcher = this.words.every((word, index) => word === normalized[index])
      ? this.sourceMatcher : new Automaton(normalized);
  }

  check(text: NormalizedText, maxMatches: number): KeywordResult {
    const matchesInSource: KeywordMatch[] = [];
    const matchesInNormalize: KeywordMatch[] = [];
    const add = (wordIndex: number, start: number, end: number, inSource: boolean): void => {
      if (matchesInSource.length + matchesInNormalize.length >= maxMatches) {
        throw new RangeError(`Keyword matches exceed maxMatches (${maxMatches}).`);
      }
      const source = inSource ? { start, end } : mapNormalizedRange(text, start, end);
      const normalized = inSource ? mapSourceRange(text, start, end) : { start, end };
      (inSource ? matchesInSource : matchesInNormalize).push({
        hitWord: this.words[wordIndex]!,
        wordStartInSource: source.start, wordEndInSource: source.end,
        wordStartInNormalize: normalized.start, wordEndInNormalize: normalized.end,
      });
    };
    if (this.sourceMatcher === this.normalizedMatcher && text.source === text.normalizeString) {
      // Share the scan, but project each dimension separately for grapheme spans.
      this.sourceMatcher.scan(text.source, (word, start, end) => {
        add(word, start, end, true);
        add(word, start, end, false);
      });
    } else {
      this.sourceMatcher.scan(text.source, (word, start, end) => add(word, start, end, true));
      this.normalizedMatcher.scan(text.normalizeString, (word, start, end) => add(word, start, end, false));
    }
    matchesInSource.sort((a, b) => a.wordStartInSource - b.wordStartInSource || a.wordEndInSource - b.wordEndInSource);
    matchesInNormalize.sort((a, b) => a.wordStartInNormalize - b.wordStartInNormalize || a.wordEndInNormalize - b.wordEndInNormalize);
    return {
      hit: matchesInSource.length > 0 || matchesInNormalize.length > 0,
      normalizeString: text.normalizeString, matchesInSource, matchesInNormalize,
    };
  }
}
