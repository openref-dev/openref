import { describe, expect, it } from 'vitest';
import type { IROperation } from '@openref/core';
import { runnerOperationOf } from '../../src/index';
import { simpleDocument } from '../mocks/documents';

/**
 * What the projection tells a console about a streaming operation, per SPEC 14.6.
 *
 * THE PROJECTION IS THE ONLY WAY THE FACT REACHES A PAGE. A collector puts `streaming` on the
 * operation and the page carries the projection rather than the document, so an operation whose
 * transport this function does not read is an operation whose stream nothing can open.
 */

describe('runnerOperationOf, the streaming half', () => {
  it('should carry no stream view for an operation the application says nothing about', () => {
    // Given
    const document = simpleDocument();
    const node = document.nodes.get('get-orders');

    // When
    const run = node?.kind === 'operation' ? runnerOperationOf(node, document) : undefined;

    // Then
    expect(run?.stream).toBeUndefined();
  });

  it('should read sse as the event stream format and chunked as ndjson', () => {
    // Given
    const document = simpleDocument();
    const node = document.nodes.get('get-orders');
    const operation = node?.kind === 'operation' ? node : undefined;
    if (operation === undefined) throw new Error('the fixture lost its operation');

    const streaming = (transport: 'sse' | 'chunked'): IROperation => ({
      ...operation,
      runtime: {
        streaming: {
          value: { transport, terminator: '[DONE]' },
          confidence: 'declared',
          collector: 'streamCollector',
        },
      },
    });

    // When
    const sse = runnerOperationOf(streaming('sse'), document);
    const chunked = runnerOperationOf(streaming('chunked'), document);

    // Then
    expect(sse.stream?.format).toBe('sse');
    expect(sse.stream?.terminator).toBe('[DONE]');
    expect(chunked.stream?.format).toBe('ndjson');
  });

  it('should offer no stream view for a websocket endpoint, which is not opened with a request', () => {
    // Given
    const document = simpleDocument();
    const node = document.nodes.get('get-orders');
    const operation = node?.kind === 'operation' ? node : undefined;
    if (operation === undefined) throw new Error('the fixture lost its operation');

    // When
    const run = runnerOperationOf(
      {
        ...operation,
        runtime: {
          streaming: {
            value: { transport: 'websocket' },
            confidence: 'declared',
            collector: 'streamCollector',
          },
        },
      },
      document,
    );

    // Then
    expect(run.stream).toBeUndefined();
  });

  it('should reduce a named item schema to the keywords the bounded check reads', () => {
    // Given
    const document = simpleDocument();
    const node = document.nodes.get('get-orders');
    const operation = node?.kind === 'operation' ? node : undefined;
    if (operation === undefined) throw new Error('the fixture lost its operation');
    const [schemaId] = [...document.schemas.keys()];
    if (schemaId === undefined) throw new Error('the fixture lost its schemas');

    // When
    const run = runnerOperationOf(
      {
        ...operation,
        runtime: {
          streaming: {
            value: { transport: 'sse', itemSchema: { kind: 'named', schemaId } },
            confidence: 'declared',
            collector: 'streamCollector',
          },
        },
      },
      document,
    );

    // Then
    expect(run.stream?.itemSchema).toBeDefined();
    expect(run.stream?.itemSchema?.type).toBe('object');
    for (const property of Object.values(run.stream?.itemSchema?.properties ?? {})) {
      expect(Object.keys(property)).toEqual(['type']);
    }
  });
});
