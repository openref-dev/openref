import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha256Hex, utf8Encode } from '../../src/index';

describe('sha256Hex', () => {
  it('should match the NIST vector for the empty string', () => {
    // Given
    const input = '';

    // When
    const digest = sha256Hex(input);

    // Then
    expect(digest).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('should match the NIST vector for abc', () => {
    // Given
    const input = 'abc';

    // When
    const digest = sha256Hex(input);

    // Then
    expect(digest).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('should match the NIST vector for the two block message', () => {
    // Given
    const input = 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq';

    // When
    const digest = sha256Hex(input);

    // Then
    expect(digest).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });

  it('should agree with node crypto across lengths that cross the padding boundary', () => {
    // Given
    const lengths = [0, 1, 54, 55, 56, 63, 64, 65, 119, 120, 127, 128, 1000];
    const inputs = lengths.map((length) => 'x'.repeat(length));

    // When
    const ours = inputs.map((input) => sha256Hex(input));
    const theirs = inputs.map((input) => createHash('sha256').update(input, 'utf8').digest('hex'));

    // Then
    expect(ours).toEqual(theirs);
  });

  it('should agree with node crypto on multi byte and astral characters', () => {
    // Given
    const inputs = ['ключ', '键', '🔑 emoji', 'mixed ключ 键 🔑 tail'];

    // When
    const ours = inputs.map((input) => sha256Hex(input));
    const theirs = inputs.map((input) => createHash('sha256').update(input, 'utf8').digest('hex'));

    // Then
    expect(ours).toEqual(theirs);
  });

  it('should always produce 64 lowercase hexadecimal characters', () => {
    // Given
    const inputs = ['', 'a', 'a much longer input than one block can hold '.repeat(10)];

    // When
    const digests = inputs.map((input) => sha256Hex(input));

    // Then
    expect(digests.every((digest) => /^[0-9a-f]{64}$/.test(digest))).toBe(true);
  });
});

describe('utf8Encode', () => {
  it('should encode ascii as one byte per character', () => {
    // Given
    const text = 'abc';

    // When
    const bytes = utf8Encode(text);

    // Then
    expect([...bytes]).toEqual([0x61, 0x62, 0x63]);
  });

  it('should encode a two byte, a three byte and a four byte character', () => {
    // Given
    const text = 'é中\u{1f511}';

    // When
    const bytes = utf8Encode(text);

    // Then
    expect([...bytes]).toEqual([0xc3, 0xa9, 0xe4, 0xb8, 0xad, 0xf0, 0x9f, 0x94, 0x91]);
  });

  it('should agree with node on well formed input', () => {
    // Given
    const text = 'ключ 键 🔑';

    // When
    const ours = [...utf8Encode(text)];
    const theirs = [...Buffer.from(text, 'utf8')];

    // Then
    expect(ours).toEqual(theirs);
  });
});
