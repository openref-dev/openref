import { describe, expect, it } from 'vitest';
import {
  parseJsonPointer,
  parseReference,
  RefResolutionError,
  resolveJsonPointer,
  schemaNameFromReference,
} from '../../src/index';

describe('parseReference', () => {
  it('should treat a reference with no uri as internal', () => {
    // Given
    const reference = '#/components/schemas/Order';

    // When
    const parsed = parseReference(reference);

    // Then
    expect(parsed).toEqual({ uri: '', pointer: '/components/schemas/Order', external: false });
  });

  it('should split an external reference into document and pointer', () => {
    // Given
    const reference = 'shared.yaml#/components/schemas/Order';

    // When
    const parsed = parseReference(reference);

    // Then
    expect(parsed).toEqual({
      uri: 'shared.yaml',
      pointer: '/components/schemas/Order',
      external: true,
    });
  });

  it('should treat a whole document reference as external with an empty pointer', () => {
    // Given
    const reference = 'shared.yaml';

    // When
    const parsed = parseReference(reference);

    // Then
    expect(parsed).toEqual({ uri: 'shared.yaml', pointer: '', external: true });
  });
});

describe('parseJsonPointer', () => {
  it('should split a pointer into segments', () => {
    // Given
    const pointer = '/components/schemas/Order';

    // When
    const segments = parseJsonPointer(pointer);

    // Then
    expect(segments).toEqual(['components', 'schemas', 'Order']);
  });

  it('should decode the two escapes RFC 6901 defines', () => {
    // Given
    const pointer = '/paths/~1orders~1{id}/a~0b';

    // When
    const segments = parseJsonPointer(pointer);

    // Then
    expect(segments).toEqual(['paths', '/orders/{id}', 'a~b']);
  });

  it('should decode percent encoding before the escapes', () => {
    // Given
    const pointer = '/paths/%2Forders';

    // When
    const segments = parseJsonPointer(pointer);

    // Then
    expect(segments).toEqual(['paths', '/orders']);
  });

  it('should read an empty pointer as the whole document', () => {
    // Given
    const pointers = ['', '/'];

    // When
    const results = pointers.map((pointer) => parseJsonPointer(pointer));

    // Then
    expect(results).toEqual([[], []]);
  });

  it('should reject a pointer that does not start with a slash', () => {
    // Given
    const pointer = 'components/schemas/Order';

    // When
    const act = (): string[] => parseJsonPointer(pointer);

    // Then
    expect(act).toThrow(RefResolutionError);
  });
});

describe('resolveJsonPointer', () => {
  it('should walk into nested objects', () => {
    // Given
    const document = { components: { schemas: { Order: { type: 'object' } } } };

    // When
    const target = resolveJsonPointer(document, '/components/schemas/Order');

    // Then
    expect(target).toEqual({ type: 'object' });
  });

  it('should walk into arrays by index', () => {
    // Given
    const document = { servers: [{ url: 'a' }, { url: 'b' }] };

    // When
    const target = resolveJsonPointer(document, '/servers/1/url');

    // Then
    expect(target).toBe('b');
  });

  it('should return the document itself for an empty pointer', () => {
    // Given
    const document = { openapi: '3.1.0' };

    // When
    const target = resolveJsonPointer(document, '');

    // Then
    expect(target).toBe(document);
  });

  it('should resolve a member whose value is null rather than calling it missing', () => {
    // Given
    const document = { nullable: null };

    // When
    const target = resolveJsonPointer(document, '/nullable');

    // Then
    expect(target).toBeNull();
  });

  it('should raise when a segment is missing', () => {
    // Given
    const document = { components: {} };

    // When
    const act = (): unknown => resolveJsonPointer(document, '/components/schemas/Order');

    // Then
    expect(act).toThrow(RefResolutionError);
    expect(act).toThrow(/leaves the document/);
  });

  it('should raise when an array index is out of range', () => {
    // Given
    const document = { servers: [{ url: 'a' }] };

    // When
    const act = (): unknown => resolveJsonPointer(document, '/servers/4');

    // Then
    expect(act).toThrow(RefResolutionError);
  });

  it('should not read a prototype member', () => {
    // Given
    const document = { components: {} };

    // When
    const act = (): unknown => resolveJsonPointer(document, '/constructor');

    // Then
    expect(act).toThrow(RefResolutionError);
  });
});

describe('schemaNameFromReference', () => {
  it('should take the last pointer segment as the name', () => {
    // Given
    const references = ['#/components/schemas/Order', 'shared.yaml#/definitions/Money'];

    // When
    const names = references.map((reference) => schemaNameFromReference(reference));

    // Then
    expect(names).toEqual(['Order', 'Money']);
  });

  it('should fall back to the uri when the reference has no pointer', () => {
    // Given
    const reference = 'shared.yaml';

    // When
    const name = schemaNameFromReference(reference);

    // Then
    expect(name).toBe('shared.yaml');
  });
});
