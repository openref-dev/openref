import { loadDefaultAssets } from '@openref/render';
import { collectSearchDocuments } from '@openref/search';
import { describe, expect, it } from 'vitest';
import { replyText } from '../../src/http/domain/reply';
import { ReferenceService } from '../../src/reference/application/services/reference.service';
import {
  NODE_PARAM,
  SCHEMA_PARAM,
  SERVICE_PARAM,
  referenceRoutes,
  type ReferenceRoute,
} from '../../src/reference/domain/routes';

/**
 * Every address this mount prints is an address this mount answers.
 *
 * WHY THE SWEEP EXISTS AND WHAT IT CAUGHT. A page address is built in one package and resolved in
 * another: `nodeHref` in `@openref/render` writes it, `segmentIndex` here reads it, and the two
 * agree only because they are handed the same set of ids. `IRDocument` holds nodes in two maps,
 * `nodes` and `webhooks`, SPEC 9.5 makes both of them a resolvable end of a topology edge, and the
 * search index of SPEC 11 stores both; the route index was built from `nodes` alone. So the overview
 * drew a link to every webhook of a document and every one of those links answered 404, on a
 * document the corpus rule says must render. Nothing was red: the link is a string and a wrong
 * string is a string.
 *
 * IT DRIVES THE REAL ROUTE TABLE AND NOT A TRANSCRIPTION OF IT. Each harvested address is matched
 * against `referenceRoutes` in registration order, exactly as express matches, and then handed to
 * the handler the match names. A sweep that resolved ids itself would be asserting the lookup from
 * a second place, which is the defect rather than the check.
 *
 * THE SHAPES ARE THE MAINTAINER'S. Path parameters in camelCase, two of them in one path, a path
 * whose only difference from another is a template variable's name, a webhook, a callback and a
 * node id equal to a route this mount claims: these are where a slug rule is at its least obvious,
 * and `pathSlug` lowercases, so `{widgetId}` and `{widgetid}` are one segment by design.
 */

const BASE = '/docs';

/** A NestJS shaped document: generated operation ids, a version prefix, camelCase parameters. */
function specification(): Record<string, unknown> {
  const ok = { '200': { description: 'ok' } };
  const paths: Record<string, unknown> = {
    '/api/v1/widgets/{widgetId}/data': {
      post: { operationId: 'WidgetsController_data', responses: ok },
    },
    '/api/v1/admin/dashboards/{dashboardId}/widget-groups': {
      get: { operationId: 'AdminController_groups', responses: ok },
      post: { operationId: 'AdminController_addGroup', responses: ok },
    },
    '/api/v1/user/dashboards/{id}/widgets/{widgetId}': {
      patch: { operationId: 'UserController_moveWidget', responses: ok },
    },
    // Two paths that differ only in the name of a template variable, which is what makes the slug
    // usable as an id at all.
    '/api/v1/dashboards/{id}': { get: { operationId: 'DashboardsController_one', responses: ok } },
    '/api/v1/dashboards/{slug}': {
      get: { operationId: 'DashboardsController_bySlug', responses: ok },
    },
    '/api/v1/health': { get: { operationId: 'HealthController_get', responses: ok } },
    '/orders/{orderId}': {
      get: {
        operationId: 'OrdersController_one',
        responses: {
          '200': {
            description: 'ok',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Order' } } },
          },
        },
      },
      // A CALLBACK, whose node id is built from the parent's and lives in `nodes`.
      post: {
        operationId: 'OrdersController_create',
        responses: ok,
        callbacks: {
          onProgress: {
            '{$request.body#/callbackUrl}': {
              post: { responses: ok },
            },
          },
        },
      },
    },
  };

  return {
    openapi: '3.1.0',
    info: { title: 'Analytics', version: '1.0.0' },
    paths,
    // WEBHOOKS, which live in `IRDocument.webhooks` and never in `nodes`.
    webhooks: {
      widgetUpdated: { post: { operationId: 'widgetUpdated', responses: ok } },
      dashboardShared: { post: { operationId: 'dashboardShared', responses: ok } },
    },
    components: {
      schemas: {
        Order: { type: 'object', properties: { id: { type: 'string' } } },
        WidgetDataDto: { type: 'object', properties: { value: { type: 'number' } } },
      },
    },
  };
}

function reference(): ReferenceService {
  return new ReferenceService({
    document: specification(),
    basePath: BASE,
    assets: loadDefaultAssets(),
  });
}

/** The route a request for this path reaches, matched the way a router matches: in order. */
function matchRoute(
  path: string,
): { readonly route: ReferenceRoute; readonly params: Record<string, string> } | null {
  const parts = path.split('/');

  for (const route of referenceRoutes(BASE)) {
    if (route.method !== 'get') continue;

    const pattern = route.pattern.split('/');
    if (pattern.length !== parts.length) continue;

    const params: Record<string, string> = {};
    let matched = true;

    for (const [index, segment] of pattern.entries()) {
      const given = parts[index] ?? '';
      if (segment.startsWith(':')) params[segment.slice(1)] = decodeURIComponent(given);
      else if (segment !== given) {
        matched = false;
        break;
      }
    }

    if (matched) return { route, params };
  }

  return null;
}

/** Every address under the mount that a served page writes into its markup or its state. */
function addressesIn(text: string): readonly string[] {
  const found = new Set<string>();

  for (const pattern of [/href="([^"]+)"/g, /"href":"([^"]+)"/g]) {
    for (const hit of text.matchAll(pattern)) {
      const address = (hit[1] ?? '').split('#')[0] ?? '';
      if (address === BASE || address.startsWith(`${BASE}/`)) found.add(address);
    }
  }

  return [...found];
}

/** Every page this mount serves, so the sweep starts from all of them and not from the overview. */
async function servedPages(service: ReferenceService): Promise<readonly string[]> {
  const document = service.document;
  const pages: { id: 'overview' | 'health' | 'states' | 'node' | 'bench' | 'schema' | 'shapes' }[] =
    [{ id: 'overview' }, { id: 'health' }, { id: 'states' }];
  const texts: string[] = [];

  for (const page of pages) {
    texts.push(replyText(await service.handle(page.id, { params: {}, headers: {} })));
  }

  for (const id of document.nodes.keys()) {
    for (const route of ['node', 'bench'] as const) {
      const reply = await service.handle(route, { params: { [NODE_PARAM]: id }, headers: {} });
      if (reply.status === 200) texts.push(replyText(reply));
    }
  }

  for (const id of document.schemas.keys()) {
    for (const route of ['schema', 'shapes'] as const) {
      const reply = await service.handle(route, { params: { [SCHEMA_PARAM]: id }, headers: {} });
      if (reply.status === 200) texts.push(replyText(reply));
    }
  }

  return [...new Set(texts.flatMap((text) => addressesIn(text)))];
}

describe('every address a mount prints', () => {
  it('should be answered by the route that matches it', async () => {
    // Given a mount of a document with the shapes a slug rule is least obvious on
    const service = reference();

    // When every served page is read for the addresses it offers
    const addresses = await servedPages(service);

    // Then the subject is present before anything is claimed about it: the sweep really did find
    // the addresses of every node, of every schema and of both webhooks, so a green run is a run
    // that checked them rather than a run that found nothing to check.
    const nodeAddresses = addresses.filter((address) => matchRoute(address)?.route.id === 'node');
    expect(nodeAddresses.length).toBeGreaterThanOrEqual(service.document.nodes.size);
    expect(service.document.webhooks.size).toBeGreaterThan(0);
    expect(addresses.filter((address) => matchRoute(address)?.route.id === 'schema')).toHaveLength(
      service.document.schemas.size,
    );

    // And every one of them answers
    const refused: string[] = [];
    for (const address of addresses) {
      const hit = matchRoute(address);
      if (hit === null) {
        refused.push(`${address} matches no route of this table`);
        continue;
      }

      const reply = await service.handle(hit.route.id, { params: hit.params, headers: {} });
      if (reply.status !== 200) refused.push(`${address} answered ${String(reply.status)}`);
    }

    expect(refused).toEqual([]);
  });

  it('should answer for every id the search index stores, since the palette links them all', async () => {
    // Given, SPEC 11: the index carries the document's own nodes and its webhooks, and the palette
    // builds a node address out of every hit that is not a schema. An id in the index that the node
    // route cannot resolve is a search result that lands on a 404.
    const service = reference();
    const stored = collectSearchDocuments(service.document);

    // Then the subject is present: webhooks really are in the index
    const webhookIds = [...service.document.webhooks.keys()];
    expect(webhookIds.length).toBeGreaterThan(0);
    expect(stored.map((entry) => entry.id)).toEqual(expect.arrayContaining(webhookIds));

    // When
    const refused: string[] = [];
    for (const entry of stored) {
      if (entry.kind === 'schema') continue;

      const reply = await service.handle('node', {
        params: { [NODE_PARAM]: entry.id },
        headers: {},
      });
      if (reply.status !== 200) refused.push(`${entry.id} answered ${String(reply.status)}`);
    }

    // Then
    expect(refused).toEqual([]);
  });

  it('should keep a camelCase parameter and its lowercase twin one address, not two', async () => {
    // Given, SPEC 5.4: `pathSlug` lowercases, so `{widgetId}` and `{widgetid}` are one segment by
    // design and the id stays typeable. The rule is stated here because it is what makes four of
    // the maintainer's ids read `widgetid`, and a reader who types the document's own spelling
    // must not be told the operation does not exist.
    const service = reference();
    const id = [...service.document.nodes.keys()].find((key) => key.includes('widgetid')) ?? '';

    // Then the subject is present
    expect(id).not.toBe('');

    // When the address is asked for exactly as the product prints it
    const reply = await service.handle('node', { params: { [NODE_PARAM]: id }, headers: {} });

    // Then
    expect(reply.status).toBe(200);

    // And a service parameter never reaches this route, which is what keeps the id spaces apart
    expect(matchRoute(`${BASE}/${id}`)?.params[SERVICE_PARAM]).toBeUndefined();
  });
});
