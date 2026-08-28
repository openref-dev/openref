import { arch, cpus, platform, totalmem } from 'node:os';
import { describe, expect, it } from 'vitest';
import { normalizeOpenApiDocument } from '@openref/core';
import { buildSite } from '../../src/index';
import { fixtureAssets, MemoryOutputStore } from '../mocks/documents';

/**
 * SPEC 20's static build budget: 1000 nodes on 4 cores in 60 seconds or less.
 *
 * THE MACHINE IS IN THE RECORD FROM THE FIRST COMMIT, which is what the `TX-CLOCK` amendment
 * asks of this threshold by name: an elapsed budget with no machine beside it is a number
 * nobody can compare with another number, and this one names a core count without naming a
 * processor. So every run prints where it ran, and a figure quoted from this suite is quoted
 * with its machine or not at all.
 *
 * WHAT THE BUDGET IS AND IS NOT ON THIS HARDWARE. Measured at T039 on the workstation named in
 * the printed line below: 1000 operations plan 2103 pages and the whole build finishes in about
 * 3 seconds, roughly twenty times inside the ceiling. At that distance the assertion is a hang
 * catcher rather than a latency budget, and it says so here rather than being read later as a
 * measurement that nearly failed. `prerender` is the precedent, and the same amendment is what
 * requires the distinction to be stated instead of left to be inferred.
 *
 * THE CORE COUNT IS PART OF THE BUDGET AND THIS BUILD USES ONE. SPEC 16.3 allows four; the
 * build is single process and sequential by choice, so a machine with four cores and a machine
 * with sixteen produce the same figure here. That makes the measurement conservative against
 * the budget rather than flattering, which is the direction a threshold should err in.
 */

/** The SPEC 20 ceiling. */
const BUDGET_MS = 60_000;

/** Nodes the budget is stated for. */
const NODES = 1000;

/** Where this figure was taken, printed with it. */
function machine(): string {
  const processors = cpus();
  return `${processors[0]?.model ?? 'unknown'}, ${String(processors.length)} cores, ${String(
    Math.round(totalmem() / 1024 ** 3),
  )} GB, ${platform()} ${arch()}`;
}

/** A document of {@link NODES} operations over a shared pool of schemas. */
function largeDocument(): ReturnType<typeof normalizeOpenApiDocument> {
  const paths: Record<string, unknown> = {};
  for (let index = 0; index < NODES; index += 1) {
    paths[`/things/${String(index)}/{id}`] = {
      get: {
        operationId: `thing${String(index)}`,
        summary: `Reads thing ${String(index)}`,
        description: `Returns thing ${String(index)} with its **fields**.`,
        tags: [`group${String(index % 20)}`],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          200: {
            description: 'ok',
            content: {
              'application/json': {
                schema: { $ref: `#/components/schemas/Thing${String(index % 50)}` },
              },
            },
          },
        },
      },
    };
  }

  const schemas: Record<string, unknown> = {};
  for (let index = 0; index < 50; index += 1) {
    schemas[`Thing${String(index)}`] = {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'integer' }, name: { type: 'string' } },
    };
  }

  return normalizeOpenApiDocument({
    openapi: '3.1.0',
    info: { title: 'Large', version: '1.0.0' },
    paths,
    components: { schemas },
  });
}

describe('the static build budget of SPEC 20', () => {
  it(
    'should build 1000 nodes inside 60 seconds, with the machine in the record',
    async () => {
      // Given
      const document = largeDocument();
      const store = new MemoryOutputStore();
      expect(document.nodes.size).toBe(NODES);

      // When
      const started = Date.now();
      const report = await buildSite({ document, store, assets: fixtureAssets() });
      const elapsed = Date.now() - started;

      // Then
      const pages = report.rendered.length + report.carried.length;
      console.log(
        `static-build: ${String(NODES)} nodes, ${String(pages)} pages in ${String(elapsed)} ms ` +
          `of ${String(BUDGET_MS)}, on ${machine()}`,
      );

      expect(pages).toBeGreaterThan(NODES);
      expect(elapsed).toBeLessThan(BUDGET_MS);
    },
    BUDGET_MS * 2,
  );
});
