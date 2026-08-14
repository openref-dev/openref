import { describe, expect, it } from 'vitest';
import type { IRConfidence, IRFact, IRNode } from '@openref/core';
import { streamCollector } from '../../src/runtime/infrastructure/collectors/stream.collector';
import { OPENREF_METADATA, OPENREF_STREAM_ITEM_METADATA } from '../../src/api/decorators/metadata';
import { NEST_SSE_METADATA } from '../../src/shared/types/nest-surface';
import type { CollectorContext } from '../../src/runtime/application/ports/collector.port';
import type { HandlerLike, ReflectorLike } from '../../src/shared/types/nest-surface';

/**
 * SPEC 13.6's priority, exercised at every level and in the failure case.
 *
 * THE ORDER IS THE SPECIFICATION, so each case below states what is available and asserts which
 * level answered. A collector that read the plugin's key first would pass a test that only checked
 * "an item schema came out", and it would quietly report a compile time guess as the truth on
 * every route where somebody had written `@ApiStream` in order to be exact.
 *
 * THE CONFIDENCE IS PART OF THE ANSWER AND IS ASSERTED WITH IT. Levels one and two are `declared`,
 * level three is `inferred`, and a fact whose level moved without its confidence moving would be
 * the failure SPEC 6.1 exists to prevent.
 */

class ProgressDto {
  percent = 0;
}

class JobsController {
  watch(): undefined {
    return undefined;
  }
}

const watch: HandlerLike = function watch() {
  return undefined;
};

/** What one route carries, as the reflector reports it. */
interface Route {
  /** `@Sse` applied. */
  readonly sse?: boolean;
  /** `@ApiStream` options. */
  readonly stream?: unknown;
  /** What the AST plugin wrote. */
  readonly pluginItem?: unknown;
  /** `itemSchema` on a response of the document. */
  readonly documentItem?: { readonly statusCode: string; readonly schemaId: string };
}

/** A reflector over one route. */
function reflectorOf(route: Route): ReflectorLike {
  return {
    get(key: unknown, target: unknown): unknown {
      if (target !== watch) return undefined;
      if (key === NEST_SSE_METADATA) return route.sse;
      if (key === OPENREF_STREAM_ITEM_METADATA) return route.pluginItem;

      return undefined;
    },
    getAllAndOverride(key: unknown): unknown {
      return key === OPENREF_METADATA.stream ? route.stream : undefined;
    },
  };
}

/** The node as the normalizer produced it, carrying `itemSchema` when the document had one. */
function nodeOf(route: Route): IRNode {
  const responses =
    route.documentItem === undefined
      ? [{ statusCode: '200', content: [] }]
      : [
          {
            statusCode: route.documentItem.statusCode,
            content: [],
            itemSchema: { kind: 'named', schemaId: route.documentItem.schemaId },
          },
        ];

  return { kind: 'operation', id: 'jobs.watch', responses } as unknown as IRNode;
}

/** A context over one route. */
function contextOf(route: Route): CollectorContext {
  return {
    node: nodeOf(route),
    controller: JobsController,
    declaredOn: JobsController,
    handler: watch,
    handlerName: 'watch',
    reflector: reflectorOf(route),
    moduleRef: { get: () => undefined },
    globalGuards: [],
    globalPipes: [],
    fact: <T>(value: T, confidence: IRConfidence): IRFact<T> => ({
      value,
      confidence,
      collector: 'streamCollector',
    }),
  };
}

describe('the four levels of SPEC 13.6, in order', () => {
  it('should take the decorator first, over everything else that could answer', () => {
    // Given all four sources available at once, which is the only arrangement that can tell an
    // ordered search from a search that happens to find the right thing
    const collector = streamCollector();
    const context = contextOf({
      sse: true,
      stream: { itemType: ProgressDto },
      documentItem: { statusCode: '200', schemaId: 'FromDocument' },
      pluginItem: 'FromPlugin',
    });

    // When
    const runtime = collector.collect(context);

    // Then
    expect(runtime?.streaming?.value.itemSchema).toEqual({
      kind: 'named',
      schemaId: 'ProgressDto',
    });
    expect(runtime?.streaming?.confidence).toBe('declared');
  });

  it('should take the document next, when no decorator declared an item type', () => {
    // Given
    const collector = streamCollector();
    const context = contextOf({
      sse: true,
      documentItem: { statusCode: '200', schemaId: 'FromDocument' },
      pluginItem: 'FromPlugin',
    });

    // When
    const runtime = collector.collect(context);

    // Then, still `declared`: OpenAPI 3.2's `itemSchema` is a written statement in the document
    expect(runtime?.streaming?.value.itemSchema).toEqual({
      kind: 'named',
      schemaId: 'FromDocument',
    });
    expect(runtime?.streaming?.confidence).toBe('declared');
  });

  it('should take the plugin third, and mark what it produced as inferred', () => {
    // Given
    const collector = streamCollector();
    const context = contextOf({ sse: true, pluginItem: 'FromPlugin' });

    // When
    const runtime = collector.collect(context);

    // Then, `inferred` rather than `declared`, because the plugin read a type name out of the
    // source and did not check what stands behind it
    expect(runtime?.streaming?.value.itemSchema).toEqual({ kind: 'named', schemaId: 'FromPlugin' });
    expect(runtime?.streaming?.confidence).toBe('inferred');
  });

  it('should report the route and emit no item schema when nothing answered', () => {
    // Given a streaming route nobody described, which is the case `stream-unspecified` is for
    const collector = streamCollector();

    // When
    const runtime = collector.collect(contextOf({ sse: true }));

    // Then the fact says it streams, and says nothing about what. An empty schema or `any` here
    // would be a guess dressed as a fact.
    expect(runtime?.streaming?.value).toEqual({ transport: 'sse' });
    expect(runtime?.streaming?.value.itemSchema).toBeUndefined();
    expect(collector.problems()).toHaveLength(1);
    expect(collector.problems()[0]?.subject).toBe('JobsController.watch');
    expect(collector.problems()[0]?.reason).toMatch(/@ApiStream/);
  });

  it('should ignore an itemSchema that belongs to an error response', () => {
    // Given, `itemSchema` on a 500 describes what an error stream carries
    const collector = streamCollector();

    // When
    const runtime = collector.collect(
      contextOf({ sse: true, documentItem: { statusCode: '500', schemaId: 'ProblemDto' } }),
    );

    // Then
    expect(runtime?.streaming?.value.itemSchema).toBeUndefined();
    expect(collector.problems()).toHaveLength(1);
  });
});

describe('what counts as a streaming route', () => {
  it('should recognise @Sse with no decorator of ours on it', () => {
    // Given, `__sse__` is the framework's own key and needs nothing from this package
    const collector = streamCollector();

    // When
    const runtime = collector.collect(contextOf({ sse: true }));

    // Then
    expect(runtime?.streaming?.value.transport).toBe('sse');
  });

  it('should recognise a declared stream that Nest has no key for', () => {
    // Given an endpoint streaming NDJSON over a plain GET, which carries no `__sse__`. Refusing
    // the fact here would throw away an explicit declaration, which SPEC 6.1 forbids.
    const collector = streamCollector();

    // When
    const runtime = collector.collect(
      contextOf({ stream: { kind: 'chunked', itemType: ProgressDto } }),
    );

    // Then
    expect(runtime?.streaming?.value.transport).toBe('chunked');
    expect(runtime?.streaming?.value.itemSchema).toEqual({
      kind: 'named',
      schemaId: 'ProgressDto',
    });
  });

  it('should say nothing at all about an ordinary route', () => {
    // Given
    const collector = streamCollector();

    // When
    const runtime = collector.collect(contextOf({}));

    // Then, no field rather than a field saying false: SPEC 6.3's runtime contract carries facts
    // that were found, and an absent one is absent
    expect(runtime).toBeUndefined();
    expect(collector.problems()).toEqual([]);
  });

  it('should refuse metadata that is not a stream declaration', () => {
    // Given a key somebody else wrote an unrelated object under
    const collector = streamCollector();

    // When
    const runtime = collector.collect(contextOf({ sse: true, stream: { kind: 'maybe' } }));

    // Then the unusable member is dropped rather than becoming a transport, and the default
    // stands, because `@Sse` is what said this route streams
    expect(runtime?.streaming?.value.transport).toBe('sse');
  });

  it('should carry the heartbeat when one was declared, and omit it when not', () => {
    // Given
    const collector = streamCollector();

    // When
    const withBeat = collector.collect(
      contextOf({ sse: true, stream: { itemType: ProgressDto, heartbeatMs: 15_000 } }),
    );
    const without = collector.collect(contextOf({ sse: true, stream: { itemType: ProgressDto } }));

    // Then
    expect(withBeat?.streaming?.value.heartbeatMs).toBe(15_000);
    expect(without?.streaming?.value.heartbeatMs).toBeUndefined();
  });
});
