import { describe, expect, it } from 'vitest';
import { nodeHref, OVERVIEW_PATH, overviewHref, pathSegmentOf } from '../../src/page/domain/links';

describe('nodeHref', () => {
  it('should build a path under the mount point', () => {
    // Given
    const nodeId = 'get-orders';

    // When
    const result = nodeHref(nodeId, '/docs');

    // Then
    expect(result).toBe('/docs/get-orders');
  });

  it('should default to the root when nothing is mounted under a prefix', () => {
    // Given
    const nodeId = 'get-orders';

    // When
    const result = nodeHref(nodeId);

    // Then
    expect(result).toBe('/get-orders');
  });

  it('should encode a node id rather than trusting it to be a slug', () => {
    // Given
    const nodeId = 'get-a b/../c?x=1';

    // When
    const result = nodeHref(nodeId);

    // Then
    expect(result).not.toContain('../');
    expect(result).not.toContain('?');
    // THE LITERAL MOVED AT T039 AND THE CLAIM DID NOT. Both characters used to be URL escaped
    // only, which is enough for a link and not enough for the file name a static build derives
    // from the same id, so they now go through `pathSegmentOf` first. What the case asserts,
    // that neither a traversal nor a query survives, is what it always asserted.
    expect(result).toBe('/get-a%20b_u002f_.._u002f_c_u003f_x%3D1');
  });
});

describe('pathSegmentOf', () => {
  it('should return an ordinary id unchanged, so no existing address moves', () => {
    // Given
    const ids = ['get-orders', 'OrderDto', 'Order__1a2b3c4d', 'post-orders-orderid-items'];

    // When
    const result = ids.map((id) => pathSegmentOf(id));

    // Then
    expect(result).toEqual(ids);
  });

  it('should escape a bidi override, which NFC keeps and a terminal reorders', () => {
    // Given
    const schemaId = 'Order\u202eDto';

    // When
    const result = pathSegmentOf(schemaId);

    // Then
    expect(result).toBe('Order_u202e_Dto');
    expect(result).not.toContain('\u202e');
  });

  it('should escape every character a file name cannot carry or a path would read', () => {
    // Given
    const ids = ['a/b', 'a\\b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b', 'a\u0000b'];

    // When
    const result = ids.map((id) => pathSegmentOf(id));

    // Then
    expect(result).toEqual([
      'a_u002f_b',
      'a_u005c_b',
      'a_u003a_b',
      'a_u002a_b',
      'a_u003f_b',
      'a_u0022_b',
      'a_u003c_b',
      'a_u003e_b',
      'a_u007c_b',
      'a_u0000_b',
    ]);
  });

  it('should escape a segment that is path grammar rather than a name', () => {
    // Given
    const ids = ['.', '..'];

    // When
    const result = ids.map((id) => pathSegmentOf(id));

    // Then
    expect(result).toEqual(['_u002e_', '_u002e__u002e_']);
  });

  it('should keep two ids that differ apart when one spells the other escape', () => {
    // Given
    const withCharacter = 'Order\u202eDto';
    const withText = 'Order_u202e_Dto';

    // When
    const escapedCharacter = pathSegmentOf(withCharacter);
    const escapedText = pathSegmentOf(withText);

    // Then
    expect(escapedCharacter).not.toBe(escapedText);
    expect(escapedText).toBe('Order_u005f_u202e_Dto');
  });
});

describe('overviewHref', () => {
  it('should point at the root when there is no mount point', () => {
    // Given
    const basePath = '';

    // When
    const result = overviewHref(basePath);

    // Then
    expect(result).toBe(OVERVIEW_PATH);
  });

  it('should point at the mount point when there is one', () => {
    // Given
    const basePath = '/docs';

    // When
    const result = overviewHref(basePath);

    // Then
    expect(result).toBe('/docs');
  });
});
