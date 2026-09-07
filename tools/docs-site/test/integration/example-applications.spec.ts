import { spawn, type ChildProcess } from 'node:child_process';
import type { Readable } from 'node:stream';
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { REPOSITORY_ROOT } from '../../src/index.ts';
import { SPAWNED_PROCESS_TIMEOUT_MS } from '../../../../vitest.spawn-timeout.ts';

/**
 * Every example application, booted as its own process and asked for a page.
 *
 * NOT A SKIP WHEN A BUILD IS MISSING. An example whose `dist/serve.js` is absent fails here and
 * names the command that produces it, because a suite that skips itself when the artifact is
 * absent is green in exactly the situation it exists to catch: the run where nothing was built.
 *
 * THE PROCESS IS SPAWNED RATHER THAN IMPORTED, and that is what the class of defect found while
 * writing these examples demands. `OpenRefModule.setup` on an application built with the default
 * `abortOnError` can end the process rather than throwing, so an in-process boot would never see
 * it: the exit code is the observation. Every case below reads the address the process prints on
 * its first line and then fetches a real page over a real socket.
 */

/** How long a spawned application gets, from the project's own declaration. */
const TIMEOUT = SPAWNED_PROCESS_TIMEOUT_MS;

/** Where the examples live. */
const EXAMPLES = join(REPOSITORY_ROOT, 'examples');

/**
 * The applications that boot and listen.
 *
 * `nuxt-reference` is not here because it is a Nuxt project rather than a Nest application, and
 * `static-build` is not here because it builds and exits; both are covered by their own cases
 * below rather than left unmentioned.
 */
const SERVING_EXAMPLES: readonly string[] = [
  'nest-minimal',
  'runtime-intelligence',
  'custom-theme',
  'events',
  'federation',
];

let running: ChildProcess | undefined;

afterEach(() => {
  running?.kill('SIGKILL');
  running = undefined;
});

/** What one booted example told us. */
interface Booted {
  readonly url: string;
  /** A second origin, for the one example that serves its remotes from another process. */
  readonly services: string;
  readonly exitCode: number | null;
  readonly stderr: string;
}

/**
 * Boots one example and reads the address off its first stdout line.
 *
 * @param name - Directory under `examples/`
 * @returns The address it printed
 */
async function boot(name: string): Promise<Booted> {
  const entry = join(EXAMPLES, name, 'dist', 'serve.js');
  if (!existsSync(entry)) {
    throw new Error(`${name} is not built: ${entry} is absent. Run "pnpm build" first`);
  }

  const child: ChildProcess & { stdout: Readable; stderr: Readable } = spawn(
    process.execPath,
    [entry, '--port=0'],
    { cwd: join(EXAMPLES, name), stdio: ['ignore', 'pipe', 'pipe'] },
  );
  running = child;

  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });

  const deadline = Date.now() + TIMEOUT - 5_000;
  for (;;) {
    const first = stdout.split('\n')[0] ?? '';
    if (first.startsWith('{')) {
      const parsed: unknown = JSON.parse(first);
      const url = (parsed as { url?: unknown }).url;
      const services = (parsed as { services?: unknown }).services;
      if (typeof url === 'string') {
        return {
          url,
          services: typeof services === 'string' ? services : '',
          exitCode: null,
          stderr,
        };
      }
      throw new Error(`${name} printed a first line with no url: ${first}`);
    }
    if (child.exitCode !== null) {
      return { url: '', services: '', exitCode: child.exitCode, stderr };
    }
    if (Date.now() > deadline) throw new Error(`${name} printed no address: ${stdout}${stderr}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** One address fetched, with its body, so a case says what came back rather than only how much. */
async function get(url: string): Promise<{ status: number; text: string }> {
  const response = await fetch(url);

  return { status: response.status, text: await response.text() };
}

/**
 * What each example is for, asserted at the addresses its own README promises.
 *
 * ONE ENTRY PER SERVING EXAMPLE, AND THE ABSENCE OF ONE IS A FAILURE RATHER THAN A GAP. The loop
 * indexes this record by name and calls what it finds, so an example added to `SERVING_EXAMPLES`
 * with no subject written here throws instead of quietly getting the `/docs` assertion alone. That
 * is the shape of the hole this record closes: every case in this file fetched `{url}/docs` and
 * nothing else until 2026-09-04, so `examples/events` was green for the whole of M5 and M6 with its
 * second mount serving nothing, `examples/federation` proved neither its service cards nor its live
 * snapshot, `examples/runtime-intelligence` would have passed with every runtime fact rendered as
 * absent, and nothing distinguished `examples/custom-theme`'s bytes from the default theme's.
 *
 * A 200 IS NOT WHAT ANY OF THESE ASSERT, WHICH IS THE WHOLE DIFFERENCE FROM THE LOOP ABOVE. A case
 * that only fetched more addresses and checked for a status would restate the same blindness one
 * level down. Each entry below reads the body and holds it to what its README says is there.
 */
const SUBJECTS: Readonly<Record<string, (booted: Booted) => Promise<void>>> = {
  /**
   * The one example whose whole subject really is `/docs`, plus the mount table `examples/README.md`
   * prints under "The one line", which is the file that is about this example.
   */
  'nest-minimal': async (booted): Promise<void> => {
    const openapi = await get(`${booted.url}/docs/openapi.json`);
    const yaml = await get(`${booted.url}/docs/openapi.yaml`);
    const index = await get(`${booted.url}/docs/_search-index`);
    const health = await get(`${booted.url}/docs/health`);
    const liveness = await get(`${booted.url}/docs/_health`);

    // The specification, both serializations, carrying the operation the README's own table opens
    const document = JSON.parse(openapi.text) as {
      openapi?: string;
      paths?: Record<string, unknown>;
    };
    expect(document.openapi).toMatch(/^3\.1/u);
    expect(Object.keys(document.paths ?? {})).toContain('/orders');
    expect(yaml.status).toBe(200);
    expect(yaml.text.startsWith('openapi: 3.1')).toBe(true);

    // The search index, keyed by the node ids the same document produced
    const search = JSON.parse(index.text) as {
      documentHash?: string;
      index?: { documentIds?: Record<string, string> };
    };
    const ids = Object.values(search.index?.documentIds ?? {});
    expect(search.documentHash).toBe(
      (JSON.parse(liveness.text) as { document?: { hash?: string } }).document?.hash,
    );
    expect(ids).toContain('post-orders');

    // One operation page, at `/docs/:nodeId`, which is the row of that table nothing reached
    const node = await get(`${booted.url}/docs/post-orders`);
    expect(node.status).toBe(200);
    expect(node.text).not.toContain('No operation of that name is documented here.');
    expect(node.text).toContain('Create an order');

    // One named schema page, at `/docs/schema/:id`, which was the last row of that table nothing
    // fetched and was recorded as a residue rather than as an unmet clause. The subject is not the
    // status: SPEC 1 promises that a named schema is a page a reader can link to instead of an
    // anonymous shape drawn inline, so what is asserted is that the page is `CustomerDto`, carries
    // the three fields the document declares for it, and draws `billingAddress` as the name
    // `AddressDto` with its own address rather than as an unnamed object.
    const schema = await get(`${booted.url}/docs/schema/CustomerDto`);
    expect(schema.status).toBe(200);
    expect(schema.text).not.toContain('No schema of that name is documented here.');
    expect(schema.text).toMatch(/<h1[^>]*>CustomerDto<\/h1>/u);
    expect(schema.text).toContain('Where receipts are sent.');
    expect(schema.text).toContain('The address the invoice carries.');
    expect(schema.text).toContain('AddressDto');
    expect(schema.text).toContain('/docs/schema/AddressDto');

    // The health page, which is a page and not the liveness JSON, and the liveness JSON, which
    // reports a reference that has nodes in it
    expect(health.status).toBe(200);
    expect(health.text).toContain('<!DOCTYPE html>');
    expect(JSON.parse(liveness.text)).toMatchObject({ status: 'ok' });
    expect(
      (JSON.parse(liveness.text) as { document?: { nodes?: number } }).document?.nodes,
    ).toBeGreaterThan(0);
  },

  /**
   * Provenance on a node page, which is the whole of what this example exists to show and which no
   * fetch of `/docs` can see: a mount rendering every runtime fact as absent serves that overview
   * byte for byte.
   */
  'runtime-intelligence': async (booted): Promise<void> => {
    const derivedScopes = await get(`${booted.url}/docs/get-inventory`);
    const declaredScopes = await get(`${booted.url}/docs/post-inventory-reserve`);
    const nothingDeclared = await get(`${booted.url}/docs/get-inventory-sku`);

    // Three pages, and the three states of a runtime fact its README names, one per page
    expect(derivedScopes.status).toBe(200);
    expect(derivedScopes.text).toContain('inventory:read');
    expect(derivedScopes.text).toContain('derived');

    expect(declaredScopes.status).toBe(200);
    expect(declaredScopes.text).toContain('inventory:write');
    expect(declaredScopes.text).toContain('declared');

    // And the third, which is the one the README says is reported as an absence rather than drawn
    // as a blank: the guard is named, and no scope is claimed for it anywhere on the page
    expect(nothingDeclared.status).toBe(200);
    expect(nothingDeclared.text).toContain('AbilityGuard');
    expect(nothingDeclared.text).not.toContain('inventory:read');
    expect(nothingDeclared.text).not.toContain('inventory:write');
  },

  /**
   * The six token values, in the page's own `<style>` element, which is exactly what this example's
   * README promises and the only thing that distinguishes its bytes from the default theme's.
   */
  'custom-theme': async (booted): Promise<void> => {
    const page = await get(`${booted.url}/docs`);

    // Every value of `src/acme.theme.ts`, in a `<style>` element rather than on an attribute, since
    // an inline style attribute is what a nonce can never authorize
    expect(page.text).toContain('--oref-color-accent-link:#b8482c');
    expect(page.text).toContain('--oref-color-accent-bg:#b8482c');
    expect(page.text).toContain('--oref-color-accent-soft:#f6e2dc');
    expect(page.text).toContain('--oref-radius-md:2px');
    expect(page.text).toContain('--oref-radius-sm:2px');
    expect(page.text).toContain('--oref-radius-lg:3px');
    expect(page.text).toMatch(/<style>[^<]*--oref-color-accent-link/u);
    expect(page.text).not.toMatch(/\sstyle="/u);
  },

  /**
   * The second mount, which is this example's whole subject and which the case below covers in
   * full. Named here rather than left out, because a missing entry is a failure and silence about
   * one example would read as an oversight rather than as a decision.
   */
  events: async (booted): Promise<void> => {
    const page = await get(`${booted.url}/docs/events`);

    expect(page.status).toBe(200);
    expect(page.text).toContain('Orders events');
  },

  /**
   * Service cards and the live snapshot, which is what this example is for and which its README now
   * writes down. Three cards, because a federation of three services that serves one card is a
   * state the overview page cannot distinguish.
   */
  federation: async (booted): Promise<void> => {
    const snapshot = await get(`${booted.url}/docs/_federation`);
    const parsed = JSON.parse(snapshot.text) as {
      availability?: string;
      remotes?: readonly { id?: string; status?: string }[];
    };

    // The snapshot names both remotes and says each is up, which is what the status dot reads
    expect(snapshot.status).toBe(200);
    expect(parsed.availability).toBe('ready');
    expect((parsed.remotes ?? []).map((remote) => remote.id).sort()).toEqual([
      'orders',
      'payments',
    ]);
    expect((parsed.remotes ?? []).map((remote) => remote.status)).toEqual(['fresh', 'fresh']);

    // One card per service, each naming its own service and not another's
    for (const [id, title] of [
      ['billing', 'Billing'],
      ['orders', 'Orders'],
      ['payments', 'Payments'],
    ] as const) {
      const card = await get(`${booted.url}/docs/service/${id}`);
      expect(card.status, `the card for ${id}`).toBe(200);
      expect(card.text).toContain(`Service: ${title}`);
    }

    // The local service's own unfederated mount, and one remote on the second process, both of
    // which the banner prints and neither of which anything fetched
    const billing = await get(`${booted.url}/billing-docs`);
    expect(billing.status).toBe(200);
    expect(billing.text).toContain('oref-root');

    expect(booted.services).toMatch(/^https?:\/\/\S+$/u);
    const orders = await get(`${booted.services}/orders-docs`);
    expect(orders.status).toBe(200);
    expect(orders.text).toContain('oref-root');
  },
};

describe('the example applications', () => {
  it('should be the whole of the examples directory, minus the two that do not listen', () => {
    // Given
    const directories = readdirSync(EXAMPLES).filter((entry) =>
      statSync(join(EXAMPLES, entry)).isDirectory(),
    );

    // Then, both directions: nothing here is unaccounted for, and nothing named is missing
    expect([...directories].sort()).toEqual(
      [...SERVING_EXAMPLES, 'nuxt-reference', 'static-build'].sort(),
    );
  });

  for (const name of SERVING_EXAMPLES) {
    it(
      `should boot ${name} and serve every address its documentation promises`,
      async () => {
        // Given
        const booted = await boot(name);

        // Then, the exit code first: an application that died has no address to fetch
        expect(booted.exitCode).toBeNull();
        expect(booted.url).toMatch(/^https?:\/\/\S+$/);

        // When
        const response = await fetch(`${booted.url}/docs`);
        const html = await response.text();

        // Then
        expect(response.status).toBe(200);
        expect(html).toContain('<!DOCTYPE html>');
        expect(html).toContain('oref-root');
        expect(html).toContain('/docs/_assets/');

        // And this example's own subject, which is what `/docs` alone could never see
        await SUBJECTS[name]!(booted);
      },
      TIMEOUT,
    );
  }

  /**
   * The second mount of `examples/events`, which nothing above reaches.
   *
   * EVERY CASE ABOVE FETCHES `/docs` AND ONLY `/docs`, which is why `examples/events` was green
   * for the whole of M5 and M6 while its events reference served nothing at all. Two defects of
   * `@openref/nest`, both measured on this built example on 2026-09-03 and both fixed at `T065`:
   * `MountedReferences.onModuleInit` returned early on a map `setup` had already written, so the
   * `documents` entry never mounted; and `setup` registered `/docs/:nodeId` before `onModuleInit`
   * registered `/docs/events`, so on Express the nested mount was answered by the parameter.
   *
   * THE ADDRESSES ARE THIS EXAMPLE'S OWN README, which is the point of asserting them here rather
   * than only in `packages/nest`: the table in `examples/events/README.md` promises exactly these
   * two, and until this case existed nothing compared the promise to the process.
   *
   * THE ZERO THIS CASE CARRIED IS NOW TWO, WHICH IS WHAT IT WAS WRITTEN DOWN FOR. Between
   * 2026-09-03 and 2026-09-04 the channel count here was asserted as the number it actually was,
   * zero, with the reason: `@ApiChannel` on a plain `@Injectable()` provider was discovered by
   * nothing and `OrdersProjector` is one. SPEC 8.3 now reads the decorator on that third class kind,
   * so the expectation went red exactly as its comment promised and is the two channels this example
   * declares. The `channels` key itself is still asserted present before its contents are read, so
   * an empty map and an absent member stay distinguishable: only the second is the synthesis not
   * running at all.
   *
   * BOTH BROKERS ARE ASSERTED TOO, and they are the second thing that could not be true while there
   * were no channels: the mount configures a kafka server and an amqp one, the synthesis writes a
   * server for each protocol its channels name, and with no channel a reader saw neither.
   */
  it(
    'should serve the second mount of the events example, which is its whole subject',
    async () => {
      // Given
      const booted = await boot('events');

      // When
      const page = await fetch(`${booted.url}/docs/events`);
      const specification = await fetch(`${booted.url}/docs/events/asyncapi.json`);
      const html = await page.text();
      const document = (await specification.json()) as Record<string, unknown> & {
        asyncapi?: string;
        channels?: Record<string, { address?: string }>;
        servers?: Record<string, { protocol?: string }>;
        operations?: Record<string, { action?: string }>;
      };
      const liveness = (await (await fetch(`${booted.url}/docs/events/_health`)).json()) as {
        status?: string;
        document?: { nodes?: number };
      };

      // Then the events reference answers, and not the HTTP mount's node page
      expect(page.status).toBe(200);
      expect(specification.status).toBe(200);
      expect(html).not.toContain('No operation of that name is documented here.');
      expect(html).toContain('Orders events');
      expect(document.asyncapi).toMatch(/^3\./);

      // And the channels it really has, which is what its own README and the root README promise.
      // The key is asserted present before its contents are read: `document.channels ?? {}` would
      // read the same on a document that carries no `channels` member at all, and those are two
      // different failures, one of them the synthesis not running.
      expect(document).toHaveProperty('channels');
      expect(
        Object.values(document.channels ?? {})
          .map((channel) => channel.address)
          .sort(),
      ).toEqual(['orders.created', 'orders.shipped']);

      // And both brokers the mount configures, which the synthesis writes one of per protocol its
      // channels name, so neither could reach a reader while there were no channels
      expect(
        Object.values(document.servers ?? {})
          .map((server) => server.protocol)
          .sort(),
      ).toEqual(['amqp', 'kafka']);

      // And the direction of each operation, since `@ApiChannel({ direction })` is the half of the
      // banner that says a handler in this process receives what `POST /orders` publishes
      expect(
        Object.values(document.operations ?? {})
          .map((operation) => operation.action)
          .sort(),
      ).toEqual(['receive', 'send']);

      // And the liveness answer, which reported `ok` for this mount while it described nothing
      expect(liveness.status).toBe('ok');
      expect(liveness.document?.nodes).toBe(2);

      // And the two channel pages themselves, which nothing above reaches and which are the
      // subject SPEC 14.7 now rests its fixture choice on. That section said in the present tense
      // that this example serves no channel page at all, because `@ApiChannel` was read only on a
      // controller and on a gateway; both halves stopped being true on 2026-09-04, and the reason
      // the section gives now is the address each console is pointed at rather than a defect in
      // discovery. What is asserted here is that address, because it is the part of the reason a
      // repository can measure: that no browser opens `kafka://` or `amqp://` is a fact about the
      // platform, and the fixture's counterpart, one `ws` server at the page's own origin, is held
      // next door by `tools/browser-budget/test/unit/specification.spec.ts`.
      //
      // THE SERVERS MAP ABOVE DOES NOT COVER THIS, WHICH IS WHY IT IS FETCHED. Measured by planting
      // a configured server whose protocol matches no channel: the synthesis kept `['amqp',
      // 'kafka']` and the page printed `kafka://` with no host at all, so the equality above stayed
      // green while the address a reader is shown had lost its host.
      const created = await fetch(`${booted.url}/docs/events/channel-orders-created`);
      const shipped = await fetch(`${booted.url}/docs/events/channel-orders-shipped`);
      const createdHtml = await created.text();
      const shippedHtml = await shipped.text();

      // The pages are asserted present before anything is read off them: a 404 body carries no
      // broker address either, and the console this section is about is drawn on neither.
      expect(created.status).toBe(200);
      expect(shipped.status).toBe(200);
      expect(createdHtml).not.toContain('No operation of that name is documented here.');
      expect(shippedHtml).not.toContain('No operation of that name is documented here.');
      expect(createdHtml).toContain('kafka://kafka.example.com:9092');
      expect(shippedHtml).toContain('amqp://rabbit.example.com:5672');
    },
    TIMEOUT,
  );

  it(
    'should build the static example, once per hosting target',
    async () => {
      // Given
      const example = (await import(join(EXAMPLES, 'static-build', 'dist', 'build-all.js'))) as {
        readonly buildEveryTarget: () => number;
        readonly OUTPUT_ROOT: string;
        readonly TARGETS: readonly { readonly name: string; readonly rewrites: boolean }[];
      };

      rmSync(example.OUTPUT_ROOT, { recursive: true, force: true });

      // When
      const code = example.buildEveryTarget();

      // Then
      expect(code).toBe(0);
      expect(readdirSync(example.OUTPUT_ROOT).sort()).toEqual(
        example.TARGETS.map((target) => target.name).sort(),
      );
      for (const target of example.TARGETS) {
        expect(existsSync(join(example.OUTPUT_ROOT, target.name, 'index.html'))).toBe(true);
      }
    },
    TIMEOUT,
  );
});
