import test from 'node:test';
import assert from 'node:assert/strict';
import { createIris, normalizeText, mapNormalizedRange, mapSourceRange } from '../dist/esm/index.js';
import { rules } from './helpers.mjs';

test('normalizes fullwidth, punctuation, emoji, whitespace and invisible controls', () => {
  const source = 'Ａ-Ｂ\nＣ\u200B\uFEFF\t💜危险\r\n词';
  const value = normalizeText(source);
  assert.equal(value.normalizeString, 'abc危险词');
  const span = mapNormalizedRange(value, 3, 6);
  assert.equal(source.slice(span.start, span.end), '危险\r\n词');
  assert.equal(value.sourceMap.length, value.normalizeString.length);
});

test('composes combining accents and Hangul while preserving complete source graphemes', () => {
  const source = '💜e\u0301 가 ﬃ 𠮷';
  const value = normalizeText(source);
  assert.equal(value.normalizeString, 'é가ffi𠮷');
  assert.deepEqual(mapNormalizedRange(value, 0, 1), { start: 2, end: 4 });
  assert.equal(source.slice(...Object.values(mapNormalizedRange(value, 1, 2))), '가');
  const end = value.normalizeString.length;
  assert.equal(source.slice(...Object.values(mapNormalizedRange(value, end - 2, end))), '𠮷');
});

test('matches source and normalized forms with stable half-open offsets', () => {
  const source = '前危\n-险\u200b词后';
  const result = createIris({ keywords: rules, aiFilter: false }).checkKeywords(source);
  assert.equal(result.hit, true);
  assert.equal(result.hite, true);
  assert.equal(result.hitWord, '危险词');
  assert.equal(result.hiteWord, result.hitWord);
  assert.equal(result.isIllegal, true);
  assert.deepEqual(result.matches[0].matchedIn, ['normalized']);
  assert.equal(source.slice(result.wordStartInSource, result.wordEndInSource), '危\n-险\u200b词');
  assert.equal(result.normalizeString.slice(result.wordStartInNormalize, result.wordEndInNormalize), '危险词');
});

test('separator removal precedes composition, preventing split-accent and split-Hangul evasion', () => {
  const source = 'e\u200b\u0301 ᄀ-ᅡ ⓐ';
  const normalized = normalizeText(source);
  assert.equal(normalized.normalizeString, 'é가a');
  assert.deepEqual(mapNormalizedRange(normalized, 0, 1), { start: 0, end: 3 });
  const result = createIris({ keywords: [{ word: 'é가', severity: 'dangerous' }] }).checkKeywords(source);
  assert.equal(result.hit, true);
  assert.equal(result.matches[0].sourceText, 'e\u200b\u0301 ᄀ-ᅡ');
});

test('merges identical source/normalized matches and retains every occurrence', () => {
  const result = createIris({ keywords: rules }).checkKeywords('危险词危险词');
  assert.equal(result.matches.length, 2);
  assert.deepEqual(result.matches.map(match => match.matchedIn), [['source', 'normalized'], ['source', 'normalized']]);
  assert.deepEqual(result.matches.map(match => match.wordStartInSource), [0, 3]);
});

test('normalizes keywords as well as input; raw punctuation matches remain visible', () => {
  const iris = createIris({ keywords: [
    { word: 'ＢＡＤ', severity: 'dangerous' }, { word: 'a-b', severity: 'general' },
    { word: '!!!', severity: 'general' },
  ] });
  assert.equal(iris.checkKeywords('b.a\nd').hitWord, 'ＢＡＤ');
  assert.equal(iris.checkKeywords('ab').hitWord, 'a-b');
  const raw = iris.checkKeywords('!!!');
  assert.equal(raw.hitWord, '!!!');
  assert.deepEqual(raw.matches[0].matchedIn, ['source']);
  assert.equal(raw.wordStartInNormalize, -1);
  assert.equal(raw.wordEndInNormalize, -1);
});

test('highest severity drives summary; list remains in source order', () => {
  const result = createIris({ keywords: rules }).checkKeywords('提醒危险词极危词');
  assert.equal(result.severity, 'extreme');
  assert.equal(result.hitWord, '极危词');
  assert.equal(result.matches.length, 3);
  assert.equal(result.matches[2].id, 'extreme-1');
  assert.equal(result.matches[2].category, 'test');
  assert.match(result.comment, /极度危险/);
});

test('general hits are advisory, configurable block threshold changes decision', () => {
  assert.equal(createIris({ keywords: rules }).checkKeywords('提醒').isIllegal, false);
  assert.equal(createIris({ keywords: rules, blockSeverity: 'general' }).checkKeywords('提醒').isIllegal, true);
});

test('automaton emits overlapping, suffix and duplicate-rule matches', () => {
  const iris = createIris({ keywords: ['a', 'aa', 'aaa', 'aa'].map(word => ({ word, severity: 'general' })) });
  assert.equal(iris.checkKeywords('aaa').matches.length, 8);
  const suffixes = createIris({ keywords: ['he', 'she', 'hers', 'his'].map(word => ({ word, severity: 'general' })) });
  assert.deepEqual(suffixes.checkKeywords('ushers').matches.map(match => match.hitWord), ['she', 'he', 'hers']);
});

test('NFKC expansions retain distinct normalized occurrences', () => {
  const result = createIris({ keywords: [{ word: 'f', severity: 'general' }] }).checkKeywords('ﬃ');
  assert.equal(result.matches.length, 2);
  for (const match of result.matches) assert.equal(match.sourceText, 'ﬃ');
  assert.deepEqual(result.matches.map(match => match.wordStartInNormalize), [0, 1]);
});

test('no match and disabled keyword results have explicit sentinel values', () => {
  for (const iris of [createIris({ keywords: rules }), createIris({ keywords: rules, keywordFilter: false })]) {
    const result = iris.checkKeywords('正常文本');
    assert.equal(result.hit, false);
    assert.equal(result.hitWord, null);
    assert.equal(result.wordStartInSource, -1);
    assert.deepEqual(result.matches, []);
  }
});

test('range functions validate invalid intervals', () => {
  const text = normalizeText('a-b');
  assert.deepEqual(mapSourceRange(text, 1, 2), { start: -1, end: -1 });
  for (const range of [[-1, 1], [0, 0], [0, 50], [0.5, 1]]) {
    assert.throws(() => mapNormalizedRange(text, ...range), RangeError);
    assert.throws(() => mapSourceRange(text, ...range), RangeError);
  }
});

test('resource limits reject rather than silently truncating review', () => {
  assert.throws(() => createIris({ maxInputLength: 2 }).checkKeywords('abc'), /maxInputLength/);
  assert.throws(() => createIris({ maxMatches: 2, keywords: [{ word: 'a', severity: 'general' }] }).checkKeywords('aaa'), /maxMatches/);
});

test('rule configuration is copied and invalid rules are rejected', () => {
  const mutable = [{ word: 'a', severity: 'general' }];
  const iris = createIris({ keywords: mutable });
  mutable[0].word = 'b';
  assert.equal(iris.checkKeywords('a').hit, true);
  for (const rule of [{ word: '', severity: 'general' }, { word: 'a', severity: 'invalid' }, { word: 'a', severity: 'general', comment: 3 }]) {
    assert.throws(() => createIris({ keywords: [rule] }), TypeError);
  }
});

test('deterministic fuzz: all ASCII matches agree with exhaustive literal search', () => {
  let seed = 12345;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const word = length => Array.from({ length }, () => 'abc'[Math.floor(random() * 3)]).join('');
  for (let trial = 0; trial < 100; trial++) {
    const words = Array.from({ length: 15 }, () => word(1 + Math.floor(random() * 5)));
    const input = word(50);
    const actual = createIris({ keywords: words.map(word => ({ word, severity: 'general' })) }).checkKeywords(input).matches
      .map(match => `${match.ruleIndex}:${match.wordStartInSource}:${match.wordEndInSource}`).sort();
    const expected = [];
    words.forEach((word, ruleIndex) => {
      for (let start = 0; start <= input.length - word.length; start++) {
        if (input.startsWith(word, start)) expected.push(`${ruleIndex}:${start}:${start + word.length}`);
      }
    });
    assert.deepEqual(actual, expected.sort());
  }
});
