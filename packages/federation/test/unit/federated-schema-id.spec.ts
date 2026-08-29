import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { federatedSchemaId } from '@openref/core';

/**
 * The digest inside a federated id, pinned to an implementation this repository does not own.
 *
 * EVERY OTHER CASE THAT MEETS `~s<digest>~` EITHER MATCHES ITS SHAPE OR COMPARES THE ENGINE TO
 * ITSELF, and neither would notice the digest quietly becoming something other than sha256 over
 * the NFC service id. Here the expected id is computed from `node:crypto`, and the literal is
 * asserted beside it, so a drift in the hash, in the normalization, in the eight character slice
 * or in the marker format goes red even if two of them drift together.
 */

/** The first eight hex characters of sha256 over the NFC form, computed by node, not by core. */
function independentDigest(serviceId: string): string {
  return createHash('sha256')
    .update(Buffer.from(serviceId.normalize('NFC'), 'utf8'))
    .digest('hex')
    .slice(0, 8);
}

describe('federatedSchemaId', () => {
  it('should file billing Money under the sha256 digest node computes for billing', () => {
    // Given the pair SPEC 15 namespaces in its own example
    const serviceId = 'billing';
    const schemaId = 'Money';

    // When the id is built, and the expectation is computed independently
    const id = federatedSchemaId(serviceId, schemaId);
    const expected = `~s${independentDigest(serviceId)}~${schemaId}`;

    // Then the two constructions agree, and each equals the literal
    expect(id).toBe(expected);
    expect(id).toBe('~s0c95c7ec~Money');
    expect(expected).toBe('~s0c95c7ec~Money');
  });

  it('should wrap an external id verbatim behind the same digest', () => {
    // Given a schema that already lives in the external id space
    // When it is filed under the billing service
    const id = federatedSchemaId('billing', '~x1b4f0e98~Order');

    // Then the wrapped id is carried unescaped, behind the independently computed digest
    expect(id).toBe(`~s${independentDigest('billing')}~~x1b4f0e98~Order`);
    expect(id).toBe('~s0c95c7ec~~x1b4f0e98~Order');
  });

  it('should hash the NFC form, so two spellings of one service id are one id', () => {
    // Given one service id spelled decomposed, and the digest of its composed bytes alone
    const decomposed = 'cafe\u0301';
    const composed = 'caf\u00e9';
    const digestOfComposed = createHash('sha256')
      .update(Buffer.from(composed, 'utf8'))
      .digest('hex')
      .slice(0, 8);

    // When the id is built from the decomposed spelling
    const id = federatedSchemaId(decomposed, 'X');

    // Then it carries the digest of the composed bytes, not of the bytes it arrived as
    expect(decomposed).not.toBe(composed);
    expect(id).toBe(`~s${digestOfComposed}~X`);
  });
});
