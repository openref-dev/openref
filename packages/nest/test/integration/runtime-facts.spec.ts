import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type {
  IRErrorContracts,
  IRFact,
  IRGuard,
  IRJsonValue,
  IRRateLimit,
  IRStreaming,
} from '@openref/core';
import { SPAWNED_PROCESS_TIMEOUT_MS } from '../../../../vitest.spawn-timeout.ts';

/**
 * The collectors of SPEC 6.2, exercised against a running NestJS application rather than a mock.
 *
 * WHY THIS FILE EXISTS AT ALL, GIVEN THAT EVERY COLLECTOR ALREADY HAS UNIT TESTS. Those tests
 * build a `CollectorContext` and hand it over. That proves each collector reads what it says it
 * reads, and it proves nothing about the four joints between a decorator somebody wrote and a fact
 * in the IR: `DiscoveryService` finding the controller, the pairing attaching the route to the
 * right node, the registry stamping the provenance, and the pass rehashing the document. All four
 * are between the collector and the reader, and a mock sits on the far side of all of them.
 *
 * THE PRECEDENT IS `@casl/ability`, FOUND IN T019 AND WORTH REPEATING HERE. That collector checked
 * whether its library was installed by resolving `<package>/package.json`, which an `exports` map
 * is free not to publish, so it skipped itself in exactly the projects that had CASL. Every unit
 * test passed. What found it was writing a test that asked the question against a real copy, which
 * is the same move this file makes one level up.
 *
 * IT RUNS INSIDE THE EXAMPLE PROJECT, AGAINST ITS BUILT OUTPUT, for the reason
 * `source-links.spec.ts` states: `tsc` output in `dist/`, loaded through the built `@openref/nest`
 * from that project's own `node_modules`, which is the shape a consumer deploys.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const example = join(repoRoot, 'examples', 'nest-minimal');

/** The runtime facts of one operation, as the booted application reports them back. */
interface Reported {
  readonly id: string;
  readonly method?: string;
  readonly path?: string;
  readonly guards?: readonly IRGuard[];
  readonly scopes?: IRFact<readonly string[]>;
  readonly rateLimit?: IRFact<IRRateLimit>;
  readonly streaming?: IRFact<IRStreaming>;
  readonly errors?: IRErrorContracts;
  readonly extensions?: Readonly<Record<string, IRJsonValue>>;
}

/** What the booted example says about itself. */
interface Report {
  readonly collectors: readonly string[];
  readonly skipped: readonly { readonly collector: string; readonly reason: string }[];
  readonly operations: readonly Reported[];
  /** Names in `components.schemas` of the served document, which is where SPEC 13.5 lands. */
  readonly schemas: readonly string[];
}

/**
 * The program run inside the example project.
 *
 * IT ASKS THE CONTAINER RATHER THAN THE HTTP SURFACE, because the panel that shows a runtime fact
 * is T023's and does not exist yet. `OPENREF_REFERENCES` is public API of this package for exactly
 * this kind of reader, and it holds the pass.
 */
const PROGRAM = `
import { createApp } from './dist/main.js';
import { OPENREF_REFERENCES } from '@openref/nest';

const app = await createApp('express');
const references = app.get(OPENREF_REFERENCES, { strict: false });
const mounted = references.all()[0];
const document = mounted.pass.document;

const operations = [];
for (const [id, node] of document.nodes) {
  if (node.kind !== 'operation') continue;
  operations.push({
    id,
    method: node.method,
    path: node.path,
    guards: node.runtime?.guards,
    scopes: node.runtime?.scopes,
    rateLimit: node.runtime?.rateLimit,
    streaming: node.runtime?.streaming,
    errors: node.runtime?.errors,
    extensions: node.extensions,
  });
}

process.stdout.write(
  JSON.stringify({
    collectors: document.runtime?.collectors ?? [],
    skipped: document.runtime?.skipped ?? [],
    operations,
    schemas: [...document.schemas.keys()],
  }),
);

await app.close();
`;

/**
 * The one boot, kept because booting a NestJS application is the whole cost of this file.
 *
 * THE REPORT IS A PURE READ AND THE PROGRAM TAKES NO INPUT, so a second boot answers the first
 * one's question again at the first one's price. Seven cases at seven boots is what pushed this
 * file and `source-links.spec.ts` past vitest's five second default under the coverage gate,
 * which is the only run that takes the integration suite and V8 instrumentation together. That
 * is session 22's fourth breakage exactly, and the answer here is the redundant work rather than
 * a larger timeout: a spawn that is done once cannot be raced by instrumentation.
 */
let cached: Report | undefined;

/**
 * Boots the example and reads its report.
 *
 * @returns What the application said about its own runtime facts
 */
function report(): Report {
  if (cached !== undefined) return cached;

  if (!existsSync(join(example, 'dist', 'main.js'))) {
    throw new Error('examples/nest-minimal is not built. Run pnpm build; a skip is not a pass');
  }

  const printed = execFileSync(process.execPath, ['--input-type=module', '-e', PROGRAM], {
    cwd: example,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  cached = JSON.parse(printed) as Report;

  return cached;
}

/**
 * Finds one operation of the example by method and path.
 *
 * BY THE ROUTE RATHER THAN BY THE OPERATION ID, because the id is `@nestjs/swagger`'s and changes
 * when a method is renamed, while the route is the thing a reader and the pairing both address.
 *
 * @param found - The whole report
 * @param method - HTTP method, lowercase
 * @param path - Template path as the document holds it
 * @returns The operation
 */
function operation(found: Report, method: string, path: string): Reported {
  const match = found.operations.find(
    (candidate) => candidate.method?.toLowerCase() === method && candidate.path === path,
  );

  if (match === undefined) {
    const known = found.operations.map((one) => `${String(one.method)} ${String(one.path)}`);
    throw new Error(`no ${method} ${path} in the example. It has: ${known.join(', ')}`);
  }

  return match;
}

describe('the collectors, against the running example application', () => {
  it(
    'should run every registered collector and skip none of them',
    { timeout: SPAWNED_PROCESS_TIMEOUT_MS },
    () => {
      // Given the example, which registers twelve
      const found = report();

      // Then all twelve ran. A SKIP IS THE FAILURE THIS ASSERTION EXISTS FOR: `throttlerCollector`
      // declines when `@nestjs/throttler` cannot be resolved or its version cannot be read, the
      // two keyed TX-COLLECTORS collectors decline when registered without their key, and each
      // declines by returning a reason rather than by throwing, so a boot that lost one looks
      // exactly like a boot that never had it.
      expect(found.skipped).toEqual([]);
      expect(found.collectors).toEqual([
        'sourceCollector',
        'guardsCollector',
        'declarationsCollector',
        'streamCollector',
        'scopesCollector',
        'throttlerCollector',
        'errorsCollector',
        'pipesCollector',
        'timeoutCollector',
        'headersCollector',
        'handlerScanCollector',
        'httpCodeCollector',
      ]);
    },
  );

  it(
    'should name the guard on every route of the guarded controller, at derived',
    { timeout: SPAWNED_PROCESS_TIMEOUT_MS },
    () => {
      // Given `@UseGuards(ScopesGuard)` on the controller class
      const found = report();

      // Then every operation carries it, because a controller's guards apply to all of its routes
      expect(found.operations.length).toBeGreaterThan(0);

      for (const one of found.operations) {
        expect(one.guards?.map((guard) => guard.name)).toContain('ScopesGuard');

        for (const guard of one.guards ?? []) {
          // SPEC 6.1: a guard's class name is the example the table gives for `derived`. Nothing
          // here can reach `declared`, because `@UseGuards` was written to protect the route rather
          // than to document it.
          expect(guard.confidence).toBe('derived');
          expect(guard.collector).toBe('guardsCollector');
        }
      }
    },
  );

  it(
    'should concatenate a method guard onto the class one rather than replacing it',
    { timeout: SPAWNED_PROCESS_TIMEOUT_MS },
    () => {
      // Given `@UseGuards(ThrottlerGuard)` on `list`, under a class already carrying `ScopesGuard`
      const found = report();

      // When
      const list = operation(found, 'get', '/orders');

      // Then both, and in the order NestJS runs them: the controller's first
      expect(list.guards?.map((guard) => guard.name)).toEqual(['ScopesGuard', 'ThrottlerGuard']);
    },
  );

  it(
    'should read the scopes the application declared under its own key, at derived',
    { timeout: SPAWNED_PROCESS_TIMEOUT_MS },
    () => {
      // Given `@Scopes('orders:read')` on `list` and `@Scopes('orders:write')` on `create`, both
      // written under `SCOPES_KEY`, which the example hands to `scopesCollector`
      const found = report();

      // When
      const list = operation(found, 'get', '/orders');
      const create = operation(found, 'post', '/orders');

      // Then each route reports its own, with provenance
      expect(list.scopes).toEqual({
        value: ['orders:read'],
        confidence: 'derived',
        collector: 'scopesCollector',
      });
      expect(create.scopes).toEqual({
        value: ['orders:write'],
        confidence: 'derived',
        collector: 'scopesCollector',
      });
    },
  );

  it(
    'should report no scopes at all for a route that declares none',
    { timeout: SPAWNED_PROCESS_TIMEOUT_MS },
    () => {
      // Given `/orders/categories`, which is behind the same guard and says nothing under the key.
      // THE HONEST ANSWER IS ABSENCE AND NOT AN EMPTY LIST: an empty list would claim the route was
      // examined and needs no scopes, which is a claim about what the guard decides, and guard logic
      // is never read. What the reference has instead is the `doctor` reason T022 renders.
      const found = report();

      // When
      const categories = operation(found, 'get', '/orders/categories');

      // Then
      expect(categories.scopes).toBeUndefined();
      expect(categories.guards?.map((guard) => guard.name)).toEqual(['ScopesGuard']);
    },
  );

  it(
    'should read the rate limit the throttler enforces, in milliseconds, at derived',
    { timeout: SPAWNED_PROCESS_TIMEOUT_MS },
    () => {
      // Given `@Throttle({ default: { limit: 30, ttl: 60_000 } })` on `list`
      const found = report();

      // When
      const list = operation(found, 'get', '/orders');

      // Then. THE UNIT IS THE ASSERTION THAT MATTERS. `ttl` was seconds before `@nestjs/throttler`
      // 5.0 and is milliseconds from 5.0, `IRRateLimit.ttlMs` is milliseconds, and the collector
      // reads the installed version to decide which it was given. A collector that got that wrong
      // reports a number that looks fine and is out by a factor of a thousand.
      expect(list.rateLimit).toEqual({
        value: { name: 'default', limit: 30, ttlMs: 60_000 },
        confidence: 'derived',
        collector: 'throttlerCollector',
      });
    },
  );

  it(
    'should leave every unthrottled route without a rate limit',
    { timeout: SPAWNED_PROCESS_TIMEOUT_MS },
    () => {
      // Given. The throttler's own module is configured globally, and a global default is not a
      // property of a route: `@Throttle` is what puts one on a route, and nothing else does.
      const found = report();

      // When, Then
      for (const one of found.operations) {
        if (one.method?.toLowerCase() === 'get' && one.path === '/orders') continue;
        expect(one.rateLimit).toBeUndefined();
      }
    },
  );
});

/**
 * T020, against the same running application: what a person declared, and what it became.
 *
 * THE JOINTS THESE COVER ARE THE ONES A UNIT TEST CANNOT REACH. A decorator writing a key is
 * proved in `test/unit/api-decorators.spec.ts`, and a collector reading one in the two collector
 * files. What is between them is `@nestjs/swagger` building the operation, the merge putting a
 * synthetic schema into the document at intake, the normalizer carrying an extension into the IR,
 * and the registry stamping provenance. All four sit between the decorator and the reader.
 */
describe('the decorators of SPEC 13.4, against the running example application', () => {
  it(
    'should report a declared scope at declared, beside a derived one on another route',
    { timeout: SPAWNED_PROCESS_TIMEOUT_MS },
    () => {
      // Given `@ApiScopes('orders:read')` on the paged route and the application's own `@Scopes`
      // on the listing route. Two routes, two levels, one document: this is the pair SPEC 6.1 is
      // about, and the confidences have to differ.
      const found = report();

      // When
      const paged = operation(found, 'get', '/orders/page');
      const listed = operation(found, 'get', '/orders');

      // Then
      expect(paged.scopes).toEqual({
        value: ['orders:read'],
        confidence: 'declared',
        collector: 'declarationsCollector',
      });
      expect(listed.scopes).toEqual({
        value: ['orders:read'],
        confidence: 'derived',
        collector: 'scopesCollector',
      });
    },
  );

  it(
    'should carry the declared item type of the SSE route into the IR',
    { timeout: SPAWNED_PROCESS_TIMEOUT_MS },
    () => {
      // Given `@Sse('events')` and `@ApiStream({ itemType: OrderEventDto })`. Reflection cannot
      // recover that type from the handler's signature at any confidence, per SPEC 6.1, so this is
      // level one of SPEC 13.6 travelling the whole way.
      //
      // THE TERMINATOR JOINED IT AT T030, AND ITS ABSENCE HERE WAS THE DEFECT. The decorator has
      // accepted `terminator` since M1 and `IRStreaming` had no field for it, so the example
      // declared `[DONE]` and the IR said nothing: declared but never filled, in the SPEC 0 sense.
      // A console cannot end a stream normally on a value nothing carried to it.
      const found = report();

      // When
      const events = operation(found, 'get', '/orders/events');

      // Then
      expect(events.streaming).toEqual({
        value: {
          transport: 'sse',
          itemSchema: { kind: 'named', schemaId: 'OrderEventDto' },
          terminator: '[DONE]',
        },
        confidence: 'declared',
        collector: 'streamCollector',
      });
    },
  );

  it(
    'should leave every route that does not stream without a streaming fact',
    { timeout: SPAWNED_PROCESS_TIMEOUT_MS },
    () => {
      // Given, an ordinary handler is not described as a stream because the application has one
      const found = report();

      // When, Then
      for (const one of found.operations) {
        if (one.path === '/orders/events') continue;
        expect(one.streaming).toBeUndefined();
      }
    },
  );

  it(
    'should put the audience marking and the code sample in the document',
    { timeout: SPAWNED_PROCESS_TIMEOUT_MS },
    () => {
      // Given `@ApiAudience('internal')` and `@ApiSample(...)`, which write `x-` extensions into
      // the object `@nestjs/swagger` builds its operation from. They reach the IR through the
      // normalizer's own extension reader, which is why nothing in `IRNodeRuntime` had to change.
      const found = report();

      // When
      const receipt = operation(found, 'get', '/orders/{id}/receipt');
      const events = operation(found, 'get', '/orders/events');

      // Then
      expect(receipt.extensions?.['x-openref-audience']).toBe('internal');
      expect(events.extensions?.['x-codeSamples']).toEqual([
        { lang: 'bash', label: 'curl', source: 'curl -N http://localhost:3000/orders/events' },
      ]);
    },
  );

  it(
    'should merge the synthetic schema of paginated(OrderDto) into the served document',
    { timeout: SPAWNED_PROCESS_TIMEOUT_MS },
    () => {
      // Given `@ApiOkResponse(paginated(OrderDto))` on the paged route. The name is built from the
      // inner class, deterministically, and the body is merged at intake rather than registered
      // with `@nestjs/swagger`, which this package never imports.
      const found = report();

      // Then it is a schema of the document like any other, which is what makes it reachable from
      // an SDK generator and from the schema page
      expect(found.schemas).toContain('PaginatedOrderDto');
      expect(found.schemas).toContain('OrderDto');

      // And nothing was duplicated by the factory being called once per build
      const paginatedNames = found.schemas.filter((name) => name.startsWith('Paginated'));
      expect(paginatedNames).toEqual(['PaginatedOrderDto']);
    },
  );
});

/**
 * T021, against the same running application: the three groups of SPEC 6.4, kept apart.
 *
 * THE JOINT THIS FILE REACHES AND A UNIT TEST DOES NOT is the one between three separate
 * collectors and one derivation. `errorsCollector` reads a decorator, `guardsCollector` names a
 * guard, `throttlerCollector` reads a limit out of a third party package, they merge, and only
 * then does the derivation run over the merged record. A mock supplies all of that at once, so it
 * cannot show that the pieces reach each other in a real boot in the right order.
 */
describe('the error contracts of SPEC 6.4, against the running example application', () => {
  it(
    'should put a declared error in the declared group, with its catalog entry',
    { timeout: SPAWNED_PROCESS_TIMEOUT_MS },
    () => {
      // Given `@ApiErrors(OrderNotFoundError)` on `read` and `ORDER_ERRORS` handed to the collector
      const found = report();

      // When
      const read = operation(found, 'get', '/orders/{id}');

      // Then the whole entry travelled: the status and the title and the type the application wrote
      expect(read.errors?.declared).toHaveLength(1);
      expect(read.errors?.declared[0]).toMatchObject({
        status: 404,
        title: 'Order not found',
        type: 'https://example.com/errors/order-not-found',
        origin: 'declared',
        confidence: 'declared',
        collector: 'errorsCollector',
      });
    },
  );

  it(
    'should read a static status off a declared class, which needs no catalog',
    { timeout: SPAWNED_PROCESS_TIMEOUT_MS },
    () => {
      // Given `@ApiErrors(OrderConflictError)` on `create`, and that class carrying `static status`
      const found = report();

      // When
      const create = operation(found, 'post', '/orders');

      // Then
      expect(create.errors?.declared).toMatchObject([
        { status: 409, title: 'OrderConflictError', origin: 'declared', confidence: 'declared' },
      ]);
    },
  );

  it(
    'should put the throttler 429 in the derived group and never in the declared one',
    { timeout: SPAWNED_PROCESS_TIMEOUT_MS },
    () => {
      // Given `@Throttle` on `list`. THIS IS T021'S SECOND CASE, and it is about which group a fact
      // lands in rather than whether it was found: a rate limit is an observation about the route,
      // and nobody promised 429 by writing it down.
      const found = report();

      // When
      const list = operation(found, 'get', '/orders');

      // Then
      expect(list.errors?.declared).toEqual([]);
      expect(list.errors?.runtimeDerived.map((one) => one.status)).toContain(429);

      const derived429 = list.errors?.runtimeDerived.find((one) => one.status === 429);
      expect(derived429?.origin).toBe('runtime-derived');
      expect(derived429?.confidence).toBe('derived');
      // The collector named is the one that had the fact, not the derivation, so a reader chasing
      // the 429 arrives somewhere that can show them something.
      expect(derived429?.collector).toBe('throttlerCollector');
    },
  );

  it(
    'should leave every unthrottled route without a 429 anywhere',
    { timeout: SPAWNED_PROCESS_TIMEOUT_MS },
    () => {
      // Given, no fact, no contract
      const found = report();

      // When, Then
      for (const one of found.operations) {
        if (one.method?.toLowerCase() === 'get' && one.path === '/orders') continue;
        expect(one.errors?.runtimeDerived.map((each) => each.status) ?? []).not.toContain(429);
      }
    },
  );

  it(
    'should derive 401 and 403 on every guarded route, from the guard and not from its code',
    { timeout: SPAWNED_PROCESS_TIMEOUT_MS },
    () => {
      // Given `@UseGuards(ScopesGuard)` on the controller
      const found = report();

      // When, Then
      for (const one of found.operations) {
        const statuses = one.errors?.runtimeDerived.map((each) => each.status) ?? [];
        expect(statuses).toContain(401);
        expect(statuses).toContain(403);

        for (const each of one.errors?.runtimeDerived ?? []) {
          expect(each.confidence).toBe('derived');
          expect(each.origin).toBe('runtime-derived');
        }
      }
    },
  );

  it(
    'should give a route with no declarations an empty declared group rather than an invented one',
    { timeout: SPAWNED_PROCESS_TIMEOUT_MS },
    () => {
      // Given `/orders/categories`, which is guarded, sits under an application wide contract, and
      // declares nothing of its own. THIS IS T021'S THIRD CASE. The group is present and empty,
      // which says the route was examined; nothing was promoted out of the other two groups to
      // fill it.
      const found = report();

      // When
      const categories = operation(found, 'get', '/orders/categories');

      // Then
      expect(categories.errors?.declared).toEqual([]);
      expect(categories.errors?.global).toHaveLength(1);
      expect(categories.errors?.runtimeDerived.length).toBeGreaterThan(0);
    },
  );

  it(
    'should put the application wide contract on every operation, in the global group',
    { timeout: SPAWNED_PROCESS_TIMEOUT_MS },
    () => {
      // Given `errorsCollector({ global: [...] })` in `app.module.ts`
      const found = report();

      // When, Then
      for (const one of found.operations) {
        expect(one.errors?.global).toMatchObject([
          { status: 500, title: 'Internal Server Error', origin: 'global', confidence: 'declared' },
        ]);
      }
    },
  );

  it(
    'should keep the three groups separate on every operation, with no member in the wrong one',
    { timeout: SPAWNED_PROCESS_TIMEOUT_MS },
    () => {
      // Given. THE STRUCTURAL CLAIM OF T021, CHECKED ON A REAL DOCUMENT: there is no list anywhere
      // holding members of two groups, and every member agrees with the group it sits in.
      const found = report();

      // When, Then
      for (const one of found.operations) {
        expect(Object.keys(one.errors ?? {}).sort()).toEqual([
          'declared',
          'global',
          'runtimeDerived',
        ]);

        for (const each of one.errors?.declared ?? []) expect(each.origin).toBe('declared');
        for (const each of one.errors?.runtimeDerived ?? [])
          expect(each.origin).toBe('runtime-derived');
        for (const each of one.errors?.global ?? []) expect(each.origin).toBe('global');
      }
    },
  );

  it(
    'should give every contract the RFC 9457 body, whichever group it is in',
    { timeout: SPAWNED_PROCESS_TIMEOUT_MS },
    () => {
      // Given
      const found = report();

      // When
      const read = operation(found, 'get', '/orders/{id}');
      const all = [
        ...(read.errors?.declared ?? []),
        ...(read.errors?.runtimeDerived ?? []),
        ...(read.errors?.global ?? []),
      ];

      // Then. THE CONCATENATION ABOVE IS WRITTEN OUT ON PURPOSE, which is the property SPEC 6.4 is
      // after: getting one list took three named reads and a deliberate spread, so nothing does it
      // by accident.
      expect(all.length).toBeGreaterThan(2);
      for (const each of all) {
        expect(each.schema?.kind).toBe('inline');
        expect(each.schema?.kind === 'inline' ? each.schema.schema.normalized?.title : '').toBe(
          'Problem Details',
        );
      }
    },
  );
});
