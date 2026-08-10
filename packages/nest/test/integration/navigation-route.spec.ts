import { describe, expect, it } from 'vitest';
import { buildNavigation, navigationHref, type NavEntryModel } from '@openref/render';
import { ReferenceService } from '../../src/reference/application/services/reference.service';
import { NAVIGATION_PARAM, referenceRoutes } from '../../src/reference/domain/routes';
import { loadDefaultAssets } from '../../src/assets/infrastructure/adapters/package-assets.adapter';

/**
 * The route that answers the fetch a sliced page makes.
 *
 * T012-R2 took the document's whole index out of every page, so the sidebar and the palette
 * ask for the rest when a reader opens something. This is the other half of that: one url, one
 * payload, immutable, and refused when it is asked for under another document's hash.
 *
 * THE URL IS COMPARED AGAINST THE ONE THE PAGE FETCHES rather than written out here. The page
 * builds it with `navigationHref` in `@openref/render` and the server registers a pattern in
 * `routes.ts`, and two spellings of one path is a broken link that neither package's own tests
 * would see.
 */

function specification(operations: number): Record<string, unknown> {
  const paths: Record<string, unknown> = {};

  for (let index = 0; index < operations; index += 1) {
    paths[`/thing-${String(index)}`] = {
      get: {
        operationId: `getThing${String(index)}`,
        tags: [`group-${String(index % 3)}`],
        responses: { '200': { description: 'ok' } },
      },
    };
  }

  return { openapi: '3.1.0', info: { title: 'Nav', version: '1.0.0' }, paths };
}

function service(): ReferenceService {
  return new ReferenceService({
    document: specification(30),
    basePath: '/docs',
    assets: loadDefaultAssets(),
  });
}

const request = (hash: string): Parameters<ReferenceService['handle']>[1] => ({
  params: { [NAVIGATION_PARAM]: hash },
  headers: {},
});

describe('the navigation route', () => {
  it('should answer the exact path the page fetches', () => {
    // Given
    const reference = service();

    // When
    const fromPage = navigationHref(reference.document.hash, '/docs');
    const pattern =
      referenceRoutes('/docs').find((route) => route.id === 'navigation')?.pattern ?? '';

    // Then the page's url matches the server's pattern with the hash in the parameter
    expect(pattern).toBe(`/docs/_navigation/:${NAVIGATION_PARAM}`);
    expect(fromPage).toBe(`/docs/_navigation/${reference.document.hash}`);
  });

  it('should serve the whole navigation, which is more than any page carries', async () => {
    // Given
    const reference = service();

    // When
    const reply = await reference.handle('navigation', request(reference.document.hash));
    const payload = JSON.parse(String(reply.body)) as {
      documentHash: string;
      navigation: NavEntryModel[];
    };

    // Then
    expect(reply.status).toBe(200);
    expect(payload.documentHash).toBe(reference.document.hash);
    // Compared as values rather than as bytes: the reply is canonicalized, per the rule that
    // everything this project serializes is, so its keys are sorted and the builder's are not.
    expect(payload.navigation).toEqual(buildNavigation(reference.document));

    // And every group arrives with its children, which is what the page did not have
    expect(payload.navigation.some((entry) => entry.children.length > 0)).toBe(true);
  });

  it('should be immutable, because the hash in the url decides the bytes', async () => {
    // Given
    const reference = service();

    // When
    const reply = await reference.handle('navigation', request(reference.document.hash));

    // Then
    expect(reply.headers['cache-control']).toContain('immutable');
    expect(reply.headers['content-type']).toContain('application/json');
  });

  it('should refuse a request for another document rather than answering with this one', async () => {
    // Given a page that outlived a deployment and is asking for the navigation it was built
    // with. Answering with the current one would hand it a sidebar that disagrees with it.
    const reference = service();

    // When
    const reply = await reference.handle('navigation', request('0000deadbeef'));

    // Then
    expect(reply.status).toBe(404);
  });

  it('should serialize once and hand back the same bytes to every reader', async () => {
    // Given
    const reference = service();

    // When
    const first = await reference.handle('navigation', request(reference.document.hash));
    const second = await reference.handle('navigation', request(reference.document.hash));

    // Then
    expect(second.body).toBe(first.body);
  });
});
