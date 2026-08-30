import { describe, expect, it } from 'vitest';
import {
  agentExposure,
  AUDIENCE_EXTENSION,
  INTERNAL_AUDIENCE,
  isInternalAudience,
  isMutatingMethod,
  SAFE_HTTP_METHODS,
} from '../../src/index';
import { channelDocument, orderDocument } from '../mocks/documents';

describe('agentExposure', () => {
  it('should withhold a node marked audience internal and name it as withheld', () => {
    // Given a document carrying one operation marked for internal eyes only, asserted present
    // first: an empty exposed list and a document that never carried the node look the same
    const document = orderDocument();
    const marked = document.nodes.get('post-admin-impersonate');
    expect(marked?.extensions?.[AUDIENCE_EXTENSION]).toBe(INTERNAL_AUDIENCE);

    // When
    const exposure = agentExposure(document);

    // Then
    expect(exposure.operations.map((node) => node.id)).toEqual(['get-orders', 'post-orders']);
    expect([...exposure.withheldNodeIds]).toEqual(['post-admin-impersonate']);
  });

  it('should keep a channel out of the operations and in a list of its own', () => {
    // Given an events document
    const document = channelDocument();

    // When
    const exposure = agentExposure(document);

    // Then, per SPEC 18 a channel is never a tool, and it is not hidden either
    expect(exposure.operations).toEqual([]);
    expect(exposure.channels.map((node) => node.address)).toEqual(['orders.created']);
    expect([...exposure.withheldNodeIds]).toEqual([]);
  });

  it('should read only the exact internal value and not any other audience', () => {
    // Given, `partner` is a documentation marking and not a reason to withhold: SPEC 18 names
    // `internal` alone, and treating every non public audience as internal would remove a
    // partner API from the surface a partner integration is the reason to switch on
    const document = orderDocument();
    const node = document.nodes.get('get-orders');
    if (node === undefined) throw new Error('the fixture lost GET /orders');
    const partner = { ...node, extensions: { [AUDIENCE_EXTENSION]: 'partner' } };

    // When, Then
    expect(isInternalAudience(partner)).toBe(false);
    expect(isInternalAudience(node)).toBe(false);
  });
});

describe('isMutatingMethod', () => {
  it('should call every safe method safe and everything else mutating', () => {
    // Given the four safe methods of RFC 9110 and the ones a document writes beside them
    const safe = SAFE_HTTP_METHODS.map((method) => isMutatingMethod(method));

    // When
    const mutating = ['post', 'put', 'patch', 'delete', 'query'].map((method) =>
      isMutatingMethod(method),
    );

    // Then
    expect(safe).toEqual([false, false, false, false]);
    expect(mutating).toEqual([true, true, true, true, true]);
  });

  it('should treat a method nobody enumerated as mutating rather than as safe', () => {
    // Given, OpenAPI 3.2 `additionalOperations` allows a method the specification does not
    // enumerate, and the marking exists so a reader confirms before acting: the closed direction
    // on an unknown method is to ask
    const unknown = 'purge';

    // When
    const result = isMutatingMethod(unknown);

    // Then
    expect(result).toBe(true);
  });

  it('should read a method whatever case the caller wrote it in', () => {
    // Given
    const written = ['GET', 'Get', 'get'];

    // When
    const results = written.map((method) => isMutatingMethod(method));

    // Then
    expect(results).toEqual([false, false, false]);
  });
});
