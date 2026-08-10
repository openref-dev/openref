import { describe, expect, it } from 'vitest';
import { nodeHref, OVERVIEW_PATH, overviewHref } from '../../src/page/domain/links';

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
    expect(result).toBe('/get-a%20b%2F..%2Fc%3Fx%3D1');
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
