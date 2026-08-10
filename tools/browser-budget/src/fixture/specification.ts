/**
 * The documents the browser budgets are measured against.
 *
 * SPEC 20 names two sizes and they are not the same document. TTI is budgeted on a thousand
 * nodes, which is a shape rather than a real API, so it is generated. Peak client memory is
 * budgeted on a document of about seven megabytes, which is a real one: `stripe.yaml` in the
 * corpus is 6.4 MB of source and the largest thing this project has ever normalized.
 *
 * THE GENERATED ONE IS THE SAME SHAPE THE jsdom CEILINGS USE. `largeDocument` in
 * `packages/render/test/mocks/documents.ts` builds the same specification and normalizes it,
 * and `test/unit/specification.spec.ts` asserts the two produce one document hash. Two
 * generators drifting apart would leave the loose ceiling in CI and the browser figure here
 * measuring different pages while both claiming to measure a thousand nodes.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repositoryRoot } from '../repo-root.js';

/** Nodes SPEC 20 budgets TTI against. */
export const TTI_NODE_COUNT = 1000;

/** The corpus document SPEC 20's memory figure is about, relative to the repository root. */
export const MEMORY_DOCUMENT = 'packages/core/test/corpus/documents/stripe.yaml';

/**
 * An OpenAPI document with `count` operations.
 *
 * Every operation carries a description, parameters and a response body, so that a page of it
 * is a real page rather than an empty one.
 *
 * @param count - Number of operations
 * @returns The document, unnormalized, as a host would hand it to `setup`
 */
export function largeSpecification(count: number): Record<string, unknown> {
  const paths: Record<string, unknown> = {};

  for (let index = 0; index < count; index += 1) {
    paths[`/resource-${String(index)}`] = {
      get: {
        operationId: `getResource${String(index)}`,
        summary: `Resource ${String(index)}`,
        description: `Reads resource **${String(index)}**.`,
        tags: [`group-${String(index % 20)}`],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'expand', in: 'query', required: false, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Found',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Resource' } },
            },
          },
        },
      },
    };
  }

  return {
    openapi: '3.1.0',
    info: { title: 'Large', version: '1.0.0' },
    paths,
    components: {
      schemas: {
        Resource: {
          type: 'object',
          properties: { id: { type: 'string' }, name: { type: 'string' } },
        },
      },
    },
  };
}

/**
 * Reads the corpus document the memory budget is measured against.
 *
 * Handed over as text, which is what a host with a specification file has, and is also what
 * makes the parse part of what is measured.
 *
 * @returns The source of `stripe.yaml`
 */
export function memorySpecification(): string {
  return readFileSync(join(repositoryRoot(), MEMORY_DOCUMENT), 'utf8');
}
