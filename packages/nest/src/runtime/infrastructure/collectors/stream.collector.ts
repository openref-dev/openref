/**
 * `streamCollector()`, which is SPEC 13.6's priority written once.
 *
 * FOUR READS IN ORDER, AND NOT ONE INFERENCE ANYWHERE. The item type of a stream is the fact this
 * project is most often expected to work out by itself, and it cannot: `Observable<MessageEvent<
 * OrderDto>>` is `Observable` at runtime, because TypeScript generics do not survive compilation.
 * So every level below is somebody having written the answer down, and the levels differ in who
 * wrote it and how sure they were:
 *
 * 1. `@ApiStream({ itemType })`, a person documenting the route. `declared`.
 * 2. `itemSchema` on the response, which OpenAPI 3.2 has a field for and the normalizer already
 *    carries. Also `declared`: it is in the specification, which is a written statement.
 * 3. The compile time AST plugin's key, read as `inferred`, because the plugin sees a type name in
 *    the source and does not check what stands behind it.
 * 4. Nothing. No `itemSchema` field at all, and a problem for `doctor`, which is where the
 *    `stream-unspecified` rule of SPEC 7.1 gets its material in T022.
 *
 * WHETHER THE ROUTE STREAMS IS A SEPARATE QUESTION FROM WHAT IT STREAMS, and both sources of the
 * first one are independent: `@Sse` writes `__sse__` and needs no decorator of ours, while
 * `@ApiStream` declares a stream that Nest has no key for, such as NDJSON over a plain GET.
 * Requiring `__sse__` would throw away an explicit declaration, which SPEC 6.1 forbids.
 */

import type { IRNode, IRSchemaSlot, IRStreamTransport, IRStreaming } from '@openref/core';
import { OPENREF_METADATA, OPENREF_STREAM_ITEM_METADATA } from '../../../api/decorators/metadata';
import type { ApiStreamOptions } from '../../../api/decorators/api-decorators';
import type { IRNodeRuntime } from '@openref/core';
import type { CollectorContext, IRuntimeCollector } from '../../application/ports/collector.port';
import { NEST_SSE_METADATA } from '../../../shared/types/nest-surface';

/** The name this collector stamps on everything it reports. */
export const STREAM_COLLECTOR_NAME = 'streamCollector';

/** A streaming route whose item type nobody stated, kept for `doctor`. */
export interface StreamCollectorProblem {
  /** `OrdersController.events`, as a reader recognises it. */
  readonly subject: string;
  /** The cause and what is not known because of it, in one clause, per SPEC 7.1. */
  readonly reason: string;
  /** The action, or that there is none and why the finding is recorded anyway, per SPEC 7.1. */
  readonly action: string;
  /** The reasoning behind it, for a reader who opens it. Absent where the cause is its own. */
  readonly detail?: string;
}

/** The collector, with the record of the streams it could not describe. */
export interface StreamCollector extends IRuntimeCollector {
  /** Streaming routes with no item type, in the order they were met. */
  problems(): readonly StreamCollectorProblem[];
}

/** Which level of SPEC 13.6 produced the item schema, exposed so a test can assert the order. */
export type StreamItemSource = 'decorator' | 'document' | 'plugin' | 'none';

/**
 * Builds the stream collector of SPEC 6.2.
 *
 * @returns The collector
 */
export function streamCollector(): StreamCollector {
  const problems: StreamCollectorProblem[] = [];

  return {
    name: STREAM_COLLECTOR_NAME,

    collect(context: CollectorContext): IRNodeRuntime | undefined {
      const declared = readStreamOptions(context);
      const isSse = context.reflector.get(NEST_SSE_METADATA, context.handler) === true;

      if (declared === undefined && !isSse) return undefined;

      const resolved = resolveItemSchema(context, declared);
      const transport: IRStreamTransport = declared?.kind ?? 'sse';

      if (resolved.slot === undefined) {
        problems.push({
          subject: `${context.declaredOn.name}.${context.handlerName}`,
          reason: 'it streams and nothing says what it streams, so the item type is unknown',
          action:
            'declare it with @ApiStream({ itemType: YourDto }) or with itemSchema on the response',
          detail:
            'Reflection cannot recover the type parameter of a stream, per SPEC 6.1: ' +
            'Observable<MessageEvent<OrderDto>> does not yield OrderDto at runtime, because ' +
            'TypeScript generics do not survive compilation. No better collector can close this.',
        });
      }

      const streaming: IRStreaming = {
        transport,
        ...(resolved.slot === undefined ? {} : { itemSchema: resolved.slot }),
        ...(declared?.heartbeatMs === undefined ? {} : { heartbeatMs: declared.heartbeatMs }),
        ...(declared?.terminator === undefined ? {} : { terminator: declared.terminator }),
      };

      // THE CONFIDENCE OF THE WHOLE FACT IS THE CONFIDENCE OF ITS WEAKEST STATED PART, which here
      // is the item schema, since that is the only member any level below `declared` can supply.
      // A fact marked `declared` whose one interesting field came from a plugin would be a lie
      // told by an aggregate, which is the shape SPEC 6.1 is written against.
      return {
        streaming: context.fact(streaming, resolved.source === 'plugin' ? 'inferred' : 'declared'),
      };
    },

    problems(): readonly StreamCollectorProblem[] {
      return problems;
    },
  };
}

/** What the search through the four levels found. */
interface ResolvedItem {
  readonly slot: IRSchemaSlot | undefined;
  readonly source: StreamItemSource;
}

/**
 * Walks the four levels of SPEC 13.6 in order and stops at the first that answers.
 *
 * @param context - What the registry handed over
 * @param declared - The `@ApiStream` options, when the decorator was applied
 * @returns The item schema and which level produced it
 */
function resolveItemSchema(
  context: CollectorContext,
  declared: ApiStreamOptions | undefined,
): ResolvedItem {
  const itemType = declared?.itemType;
  if (typeof itemType === 'function' && itemType.name !== '') {
    // A NAMED SLOT AND NOT AN INLINE SCHEMA. What is in hand is a class, and the only honest
    // statement about a class is its name: the shape belongs to the document, where
    // `@nestjs/swagger` put it. A slot naming a schema the document does not carry renders as a
    // reference elsewhere, which is what the schema viewer already shows for one.
    return { slot: { kind: 'named', schemaId: itemType.name }, source: 'decorator' };
  }

  const fromDocument = documentItemSchema(context.node);
  if (fromDocument !== undefined) return { slot: fromDocument, source: 'document' };

  const fromPlugin = pluginItemSchema(context);
  if (fromPlugin !== undefined) return { slot: fromPlugin, source: 'plugin' };

  return { slot: undefined, source: 'none' };
}

/**
 * Level two: OpenAPI 3.2's own `itemSchema`, as the normalizer carried it.
 *
 * THE FIRST SUCCESSFUL RESPONSE AND NOT ANY RESPONSE. `itemSchema` on a 500 describes what an
 * error stream carries, and reporting it as the endpoint's item type would attach the wrong
 * schema to the thing a reader is looking at.
 *
 * @param node - The node as the normalizer produced it
 * @returns The slot, or undefined when the document does not carry one
 */
function documentItemSchema(node: IRNode): IRSchemaSlot | undefined {
  if (node.kind !== 'operation') return undefined;

  for (const response of node.responses) {
    if (response.itemSchema === undefined) continue;
    if (!/^2\d\d$/.test(response.statusCode)) continue;

    return response.itemSchema;
  }

  return undefined;
}

/**
 * Level three: whatever the compile time plugin wrote, read as a name.
 *
 * A STRING IS ALL THAT IS ACCEPTED. The plugin's job is to write down the type name it saw, and a
 * key holding anything else is a key somebody else is using; reading an object out of it and
 * calling it a schema would be the guess this file exists to avoid.
 *
 * @param context - What the registry handed over
 * @returns The slot, or undefined when nothing usable is under the key
 */
function pluginItemSchema(context: CollectorContext): IRSchemaSlot | undefined {
  const raw: unknown = context.reflector.get(OPENREF_STREAM_ITEM_METADATA, context.handler);

  return typeof raw === 'string' && raw !== '' ? { kind: 'named', schemaId: raw } : undefined;
}

/**
 * Reads `@ApiStream`, from the handler or from the controller.
 *
 * @param context - What the registry handed over
 * @returns The options, or undefined when the decorator was not applied
 */
function readStreamOptions(context: CollectorContext): ApiStreamOptions | undefined {
  const raw: unknown = context.reflector.getAllAndOverride(OPENREF_METADATA.stream, [
    context.handler,
    context.controller,
  ]);

  if (typeof raw !== 'object' || raw === null) return undefined;

  // EVERY MEMBER IS CHECKED RATHER THAN ASSERTED. This key is read off a handler that anything may
  // have written on, and every field of the options is optional, so a cast would let an object
  // with none of them through as a valid declaration and a `kind` of `"maybe"` would become the
  // transport of a fact. Reading each member for what it has to be is the same rule the metadata
  // collector follows, and it is why `ReflectorLike` returns `unknown`.
  const options = raw as Record<string, unknown>;
  const kind: unknown = options.kind;
  const heartbeatMs: unknown = options.heartbeatMs;
  const terminator: unknown = options.terminator;
  const itemType: unknown = options.itemType;

  return {
    ...(isClass(itemType) ? { itemType } : {}),
    ...(isTransport(kind) ? { kind } : {}),
    ...(typeof terminator === 'string' ? { terminator } : {}),
    ...(typeof heartbeatMs === 'number' && Number.isFinite(heartbeatMs) ? { heartbeatMs } : {}),
  };
}

/**
 * Reports whether a value can be used as an item type.
 *
 * A CONSTRUCTOR IS ANY FUNCTION AT RUNTIME, and this does not pretend otherwise: an arrow function
 * passed as `itemType` is refused by the compiler at the decoration site and would reach here only
 * from a host with no types. What is checked is what is used, which is the name.
 *
 * @param value - Whatever was under `itemType`
 * @returns True when it is a function with a name
 */
function isClass(value: unknown): value is new (...args: never[]) => unknown {
  return typeof value === 'function' && value.name !== '';
}

/**
 * Reports whether a value is one of the three transports `IRStreaming` admits.
 *
 * @param value - Whatever was under `kind`
 * @returns True when it names a transport
 */
function isTransport(value: unknown): value is IRStreamTransport {
  return value === 'sse' || value === 'websocket' || value === 'chunked';
}
