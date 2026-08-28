import { describe, expect, it } from 'vitest';
import {
  BIDI_CONTROL_CODE_POINTS,
  carriesControlCharacters,
  plainArtefactText,
} from '../../src/index';

/**
 * SPEC 19.1's plain text half, added by `T043`.
 *
 * EVERY CONTROL CHARACTER IS BUILT FROM ITS CODE POINT rather than written literally, because the
 * `text-source` gate refuses a bidirectional control in a source file and this file is about
 * exactly why that is right.
 */
const ch = (code: number): string => String.fromCharCode(code);

describe('plainArtefactText', () => {
  it.each([
    ['NUL', 0x00],
    ['BEL', 0x07],
    ['ESC, which a terminal reads as the start of a control sequence', 0x1b],
    ['DEL', 0x7f],
    ['a C1 control', 0x9b],
    ['LINE SEPARATOR, which forges a line in a line oriented file', 0x2028],
    ['PARAGRAPH SEPARATOR', 0x2029],
  ])('should remove %s', (_name, code) => {
    // Given
    const text = `GET /v1${ch(code)}/refund`;

    // When
    const cleaned = plainArtefactText(text);

    // Then: presence first, so a pass cannot mean the character was never there.
    expect(carriesControlCharacters(text)).toBe(true);
    expect(cleaned).toBe('GET /v1/refund');
  });

  it('should remove every one of the twelve bidirectional controls, not the override alone', () => {
    // Given
    const texts = BIDI_CONTROL_CODE_POINTS.map((code) => `a${ch(code)}b`);

    // When
    const cleaned = texts.map((text) => plainArtefactText(text));

    // Then
    expect(BIDI_CONTROL_CODE_POINTS).toHaveLength(12);
    expect(texts.every((text) => carriesControlCharacters(text))).toBe(true);
    expect(cleaned).toEqual(texts.map(() => 'ab'));
  });

  it('should keep the line feed, which every artefact here uses as its own structure', () => {
    // Given
    const text = 'first\nsecond\n';

    // When
    const cleaned = plainArtefactText(text);

    // Then
    expect(carriesControlCharacters(text)).toBe(false);
    expect(cleaned).toBe(text);
  });

  it('should leave ordinary text, including text that is not English, exactly as written', () => {
    // Given: Arabic and Cyrillic, which the removal must not touch, since the whole reason SPEC
    // 19.1 isolates rather than strips in markup is that such a document needs its own letters.
    const text = 'GET /مسار и /путь  User.email';

    // When
    const cleaned = plainArtefactText(text);

    // Then
    expect(cleaned).toBe(text);
  });

  it('should answer about the string it was given rather than about the previous call', () => {
    // Given: a global regular expression shared between replace and test would carry lastIndex.
    const dirty = `a${ch(0x1b)}b`;

    // When
    const answers = [
      carriesControlCharacters(dirty),
      carriesControlCharacters(dirty),
      carriesControlCharacters('clean'),
      carriesControlCharacters(dirty),
    ];

    // Then
    expect(answers).toEqual([true, true, false, true]);
  });
});
