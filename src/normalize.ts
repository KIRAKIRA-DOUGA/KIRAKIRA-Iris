import { Converter } from 'opencc-js';
import type { NormalizedText, SourceSpan } from './types.js';

const segmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });
const separators = /[\p{P}\p{S}\p{Z}\p{C}\p{Default_Ignorable_Code_Point}\s]/gu;
const han = /\p{Script=Han}/u;
const chineseCache = new Map<string, string>();
let toSimplified: ((text: string) => string) | undefined;

function foldChinese(text: string): string {
  if (!han.test(text)) return text;
  toSimplified ??= Converter({ from: 't', to: 'cn' });
  return Array.from(text, char => {
    if (!han.test(char)) return char;
    const cached = chineseCache.get(char);
    if (cached !== undefined) return cached;
    // Character folding is context-independent so substring matches and offsets
    // stay stable. It intentionally does not translate regional vocabulary.
    const folded = toSimplified!(char);
    if (chineseCache.size < 8192) chineseCache.set(char, folded);
    return folded;
  }).join('');
}

/** NFKC, simplified Chinese character folding, lowercase and separator removal. */
export function normalizeText(source: string): NormalizedText {
  if (typeof source !== 'string') throw new TypeError('Input must be a string.');
  // ASCII needs neither NFKC nor grapheme composition: avoid an intermediate map.
  if (/^[\x00-\x7f]*$/.test(source)) {
    const parts: string[] = [];
    const sourceMap: SourceSpan[] = [];
    for (let index = 0; index < source.length; index++) {
      const code = source.charCodeAt(index);
      if ((code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122)) {
        parts.push(code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : source[index]!);
        sourceMap.push({ start: index, end: index + 1 });
      }
    }
    return { source, normalizeString: parts.join(''), sourceMap };
  }
  const intermediateParts: string[] = [];
  const intermediateMap: SourceSpan[] = [];
  let sourceOffset = 0;
  // Remove inserted separators before grapheme composition, while allowing NFKC
  // symbols such as circled letters to become letters rather than disappearing.
  for (const char of source) {
    const part = foldChinese(char.normalize('NFKC').replace(separators, ''));
    intermediateParts.push(part);
    for (let i = 0; i < part.length; i++) intermediateMap.push({ start: sourceOffset, end: sourceOffset + char.length });
    sourceOffset += char.length;
  }
  const intermediate = intermediateParts.join('');
  const parts: string[] = [];
  const sourceMap: SourceSpan[] = [];
  // Grapheme segmentation keeps decomposed accents, Hangul and surrogate pairs together.
  for (const { segment, index } of segmenter.segment(intermediate)) {
    const normalized = segment.normalize('NFKC').toLowerCase().replace(separators, '');
    if (!normalized) continue;
    parts.push(normalized);
    for (let i = 0; i < normalized.length; i++) {
      sourceMap.push({ start: intermediateMap[index]!.start, end: intermediateMap[index + segment.length - 1]!.end });
    }
  }
  return { source, normalizeString: parts.join(''), sourceMap };
}

/** Map a nonempty normalized interval back to a complete source span. */
export function mapNormalizedRange(text: NormalizedText, start: number, end: number): SourceSpan {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start
    || end > text.sourceMap.length) throw new RangeError('Invalid normalized range.');
  return { start: text.sourceMap[start]!.start, end: text.sourceMap[end - 1]!.end };
}

/** Project a source interval, including symbols, onto the retained normalized units. */
export function mapSourceRange(text: NormalizedText, start: number, end: number): SourceSpan {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start
    || end > text.source.length) throw new RangeError('Invalid source range.');
  const lowerBound = (predicate: (span: SourceSpan) => boolean): number => {
    let low = 0;
    let high = text.sourceMap.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (predicate(text.sourceMap[mid]!)) high = mid;
      else low = mid + 1;
    }
    return low;
  };
  const first = lowerBound(span => span.end > start);
  const last = lowerBound(span => span.start >= end);
  return first >= last ? { start: -1, end: -1 } : { start: first, end: last };
}
