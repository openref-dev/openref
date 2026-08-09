import { describe, expect, it } from 'vitest';
import { hash, sha256Hex } from '../../src/index';

/**
 * Digests recorded from the implementation that preceded `@noble/hashes`.
 *
 * The hash is a cache key and part of the reproducibility claim, so replacing the
 * compression function is only allowed if nothing observable changes. These values were
 * produced by the hand written implementation and are pinned here so that any future swap,
 * of the dependency or of the encoder, has to prove the same thing.
 *
 * Two entries carry the whole argument on their own. `\ud800` and `a\udfffb` are lone
 * surrogates: `TextEncoder` turns them into U+FFFD, this package does not, and handing the
 * dependency a string rather than bytes would have silently changed both digests.
 */
const RECORDED_TEXT_DIGESTS: readonly (readonly [string, string])[] = [
  ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
  ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
  [
    'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
  ],
  ['x'.repeat(55), 'd5e285683cd4efc02d021a5c62014694958901005d6f71e89e0989fac77e4072'],
  ['x'.repeat(56), '04c26261370ee7541549d16dee320c723e3fd14671e66a099afe0a377c16888e'],
  ['x'.repeat(64), '7ce100971f64e7001e8fe5a51973ecdfe1ced42befe7ee8d5fd6219506b5393c'],
  ['x'.repeat(1000), '44f8354494a5ba03ba1792a8d3e9c534c47a9181980fde7a3f44b06ef2ae7c7f'],
  ['key 键 🔑', 'c4cb80ef232f41f8958b1cb0cacf60d8da6f7f70681cba8d9da6c5b305667dfb'],
  ['\ud800', '91a681b998555fb475479817b126c94e57e52011fa1842c5d188795a4a05226b'],
  ['a\udfffb', '96637bd64c9c2e8b24a52ab02e2bc830179a3a455f6b6430cc46afe896266751'],
  ['\ud83d', '7586f70fb89addbc55ee252028451c6f36b6e76ca64d663e64c71bce7fd5bdff'],
  ['lone \ud800 pair 🔑 tail', 'f4f00e08aa075ab3b03efb32ddaf543ba24382a7737dac077590afc9ce43640e'],
  [' ', '36a9e7f1c95b82ffb99743e0c5c4ce95d83c9a430aac59f84ef3cbfab6145068'],
];

/** Digests of whole values, recorded through `canonicalize` by the same implementation. */
const RECORDED_VALUE_DIGESTS: readonly (readonly [unknown, string])[] = [
  [{}, '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a'],
  [{ b: 1, a: 2 }, 'd3626ac30a87e6f7a6428233b3c68299976865fa5508e4267c5415c76af7a772'],
  [[1, 2, 3], 'a615eeaee21de5179de080de8c3052c8da901138406ba71c38c032845f7d54f4'],
  [
    {
      nested: {
        map: new Map([
          ['b', 1],
          ['a', 2],
        ]),
      },
    },
    '6b9ab0278001d02ac3a926429bbd72b85b8218decdf679720b6a41566baca206',
  ],
  [
    { d: new Date('2026-08-09T00:00:00.000Z') },
    '0c97e202e207d95579e4485862689afb9120d34cc6efa9c11337469216224fe0',
  ],
  [{ n: -0, m: 1e21, k: 0.1 }, 'f12d303f0e0efbec173a4fb8b9953983c1dba231dbbcd91c6eed2561e5a56cad'],
  [
    { s: 'lone \ud800 surrogate' },
    '60fcaa1b8c2b98d3d15848312f6fb7802f343abda35670fef585a553d845b77e',
  ],
];

describe('sha256Hex, after replacing the compression function with a dependency', () => {
  it('should produce the digest recorded before the replacement, for every recorded string', () => {
    // Given
    const recorded = RECORDED_TEXT_DIGESTS;

    // When
    const actual = recorded.map(([text]) => sha256Hex(text));

    // Then
    expect(actual).toEqual(recorded.map(([, digest]) => digest));
  });

  it('should still emit a lone surrogate as three bytes rather than the replacement character', () => {
    // Given, what TextEncoder would produce for a lone surrogate
    const replacementCharacterDigest = sha256Hex('�');

    // When
    const loneSurrogateDigest = sha256Hex('\ud800');

    // Then
    expect(loneSurrogateDigest).not.toBe(replacementCharacterDigest);
    expect(loneSurrogateDigest).toBe(
      '91a681b998555fb475479817b126c94e57e52011fa1842c5d188795a4a05226b',
    );
  });
});

describe('hash, after replacing the compression function with a dependency', () => {
  it('should produce the digest recorded before the replacement, for every recorded value', () => {
    // Given
    const recorded = RECORDED_VALUE_DIGESTS;

    // When
    const actual = recorded.map(([value]) => hash(value));

    // Then
    expect(actual).toEqual(recorded.map(([, digest]) => digest));
  });
});
