import { describe, expect, it } from 'vitest';
import { canonicalize, sha256Hex } from '@openref/core';
import type { RunnableOperation, RunnableParameter } from '@openref/runner';
import { buildSampleRequest, generateCodeSamples } from '../../src/index';
import { createPet, SERVER } from '../mocks/operations';

/** A header parameter, with the defaults the normalizer fills in. */
function header(name: string): RunnableParameter {
  return { name, in: 'header', required: false, style: 'simple', explode: false };
}

/** The hash of a whole sample set, through the canonical form `core` defines. */
function hashOf(samples: readonly unknown[]): string {
  return sha256Hex(canonicalize(samples));
}

describe('generated samples are deterministic', () => {
  it('should produce one hash over a thousand generations of the same request', () => {
    // Given
    const request = buildSampleRequest(
      createPet(),
      { values: {}, serverUrl: SERVER, body: { kind: 'text', text: '{"name":"Fido"}' } },
      { apiKey: '<apiKey>' },
    );

    // When
    const hashes = new Set<string>();
    for (let attempt = 0; attempt < 1000; attempt += 1) {
      hashes.add(hashOf(generateCodeSamples(request).samples));
    }

    // Then
    expect(hashes.size).toBe(1);
  });

  it('should not move when the plan carries the same headers in a different insertion order', () => {
    // Given, two documents declaring the same three headers in opposite orders
    const names = ['X-Trace', 'Accept', 'X-Tenant'];
    const forward: RunnableOperation = { ...createPet(), parameters: names.map(header) };
    const backward: RunnableOperation = {
      ...createPet(),
      parameters: [...names].reverse().map(header),
    };
    const values = {
      'header:X-Trace': { kind: 'primitive' as const, value: 'abc' },
      'header:Accept': { kind: 'primitive' as const, value: 'application/json' },
      'header:X-Tenant': { kind: 'primitive' as const, value: 'acme' },
    };
    const inputs = { values, serverUrl: SERVER, body: { kind: 'text' as const, text: '{}' } };

    // When
    const first = buildSampleRequest(forward, inputs, { apiKey: '<apiKey>' });
    const second = buildSampleRequest(backward, inputs, { apiKey: '<apiKey>' });

    // Then, the insertion orders really do differ, and the samples do not
    expect(Object.keys(first.plan.headers)).not.toEqual(Object.keys(second.plan.headers));
    expect(hashOf(generateCodeSamples(first).samples)).toBe(
      hashOf(generateCodeSamples(second).samples),
    );
  });

  it('should use a fixed multipart boundary, so a sample is the same bytes on every run', () => {
    // Given
    const operation: RunnableOperation = {
      ...createPet(),
      body: [{ mediaType: 'multipart/form-data' }],
    };
    const inputs = {
      values: {},
      serverUrl: SERVER,
      body: {
        kind: 'fields' as const,
        fields: [{ kind: 'text' as const, name: 'a', value: 'one' }],
      },
    };

    // When
    const first = buildSampleRequest(operation, inputs, { apiKey: '<apiKey>' });
    const second = buildSampleRequest(operation, inputs, { apiKey: '<apiKey>' });

    // Then
    expect(first.contentType).toBe(second.contentType);
    expect(hashOf(generateCodeSamples(first).samples)).toBe(
      hashOf(generateCodeSamples(second).samples),
    );
  });
});
