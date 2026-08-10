import { describe, expect, it } from 'vitest';
import { bootApp, FIXTURE_APPS } from '../mocks/app-process';

/**
 * The compatibility matrix of SPEC 23, run rather than reasoned about.
 *
 * Two applications and two adapters, four boots. Each application carries its own NestJS tree
 * in its own `node_modules`, which is the only way to have two majors in one repository: the
 * framework packages resolve each other by real name, so aliasing a second version into one
 * tree gives a core that loads the other common.
 *
 * WHAT THE VERSION AXIS ACTUALLY COVERS, and it is not what SPEC 23's table said. NestJS 10
 * and 11 are both here. `@nestjs/swagger` is 8 and 11, because 9 and 10 were never published:
 * the package went from 8 straight to 11 to line its major up with NestJS. The table listing
 * "8, 9, 10, 11" named two versions that do not exist, and SPEC 23 now says so.
 *
 * The two majors differ in the Express underneath, 4 against 5, which disagree about route
 * patterns. That is the defect this test exists to catch, and it is why the route table holds
 * no wildcard.
 */

const PLATFORMS = ['express', 'fastify'] as const;

describe('the NestJS and @nestjs/swagger compatibility matrix', () => {
  for (const app of FIXTURE_APPS) {
    for (const platform of PLATFORMS) {
      it(`should serve the whole route table on ${platform}, ${app.label}`, async () => {
        // Given
        const booted = await bootApp(app, platform);

        try {
          // When
          const paths = [
            '/docs',
            '/docs/',
            '/docs/openapi.json',
            '/docs/openapi.yaml',
            '/docs/_search-index',
            '/docs/health',
          ];
          const statuses = await Promise.all(
            paths.map(async (path) => (await fetch(`${booted.url}${path}`)).status),
          );

          // Then
          expect(statuses).toEqual(paths.map(() => 200));
        } finally {
          await booted.stop();
        }
      }, 60_000);

      it(`should serve an operation page and its assets on ${platform}, ${app.label}`, async () => {
        // Given
        const booted = await bootApp(app, platform);

        try {
          const html = await (await fetch(`${booted.url}/docs`)).text();
          const bundleHref = /src="([^"]+openref\.[^"]+\.js)"/.exec(html)?.[1] ?? '';
          const styleHref = /href="([^"]+\.css)"/.exec(html)?.[1] ?? '';

          // When
          const bundle = await fetch(`${booted.url}${bundleHref}`);
          const style = await fetch(`${booted.url}${styleHref}`);
          const missing = await fetch(`${booted.url}/docs/no-such-operation`);

          // Then
          expect(bundle.status).toBe(200);
          expect(bundle.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
          expect(style.status).toBe(200);
          expect(missing.status).toBe(404);
        } finally {
          await booted.stop();
        }
      }, 60_000);
    }
  }

  it('should normalize an OpenAPI 3.0 document and a 3.1 one to the same shape of reference', async () => {
    // Given, swagger 8 emits 3.0 and swagger 11 emits 3.1. Both have to arrive as one IR, which
    // is what makes the version axis of the matrix mean anything beyond "it booted".
    const booted = await Promise.all(FIXTURE_APPS.map((app) => bootApp(app, 'express')));

    try {
      // When
      const versions = await Promise.all(
        booted.map(async (app) => {
          const document = (await (await fetch(`${app.url}/docs/openapi.json`)).json()) as {
            openapi: string;
          };
          const health = (await (await fetch(`${app.url}/docs/health`)).json()) as {
            document: { nodes: number };
          };

          return { openapi: document.openapi.slice(0, 3), nodes: health.document.nodes };
        }),
      );

      // Then
      expect(versions[0]?.openapi).toBe('3.1');
      expect(versions[1]?.openapi).toBe('3.0');
      expect(versions.every((entry) => entry.nodes > 0)).toBe(true);
    } finally {
      await Promise.all(booted.map((app) => app.stop()));
    }
  }, 60_000);
});
