import { buildDiffReport, normalizeOpenApiDocument } from '@openref/core';
import { describe, expect, it } from 'vitest';
import { envelope, paginated } from '../../src/schemas/api/generics';
import {
  mergeSyntheticSchemas,
  SyntheticSchemaRegistry,
  type SchemaClass,
} from '../../src/schemas/domain/synthetic-schemas';

/**
 * T038's third named test: the synthetic generic schema names of T020 never produce phantom
 * breaking changes across builds.
 *
 * Two builds of one application means two processes: fresh class objects, decorators running in
 * whatever order module resolution lands on, a fresh registry. Simulated here as literally that,
 * with the registration order reversed between the builds on purpose, and proved through the
 * whole pipeline: factories, merge, normalizer, `buildDiffReport`. The registry level half of
 * this promise is already pinned by `synthetic-schemas.spec.ts`; this is the end of the chain
 * the promise was made for.
 */

interface BuildClasses {
  readonly CatDto: SchemaClass;
  readonly OrderDto: SchemaClass;
  readonly PageMeta: SchemaClass;
}

/** Fresh class objects with the same names, which is what a second process has. */
function freshClasses(): BuildClasses {
  class CatDto {
    name = '';
  }
  class OrderDto {
    id = '';
  }
  class PageMeta {
    total = 0;
  }
  return { CatDto, OrderDto, PageMeta };
}

/** The host document both builds start from: its own DTOs, and routes using the wrappers. */
function hostDocument(): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: { title: 'Pets', version: '1.0.0' },
    paths: {
      '/cats': {
        get: {
          responses: {
            '200': {
              description: 'a page of cats',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/PaginatedCatDto' },
                },
              },
            },
          },
        },
      },
      '/orders': {
        post: {
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/EnvelopeOrderDto' } },
            },
          },
          responses: { '201': { description: 'created' } },
        },
      },
    },
    components: {
      schemas: {
        CatDto: { type: 'object', properties: { name: { type: 'string' } } },
        OrderDto: { type: 'object', properties: { id: { type: 'string' } } },
        PageMeta: { type: 'object', properties: { total: { type: 'integer' } } },
      },
    },
  };
}

/** One whole build: register in the given order, merge, normalize. */
function build(order: 'pages-first' | 'envelopes-first', withMeta: boolean) {
  const classes = freshClasses();
  const registry = new SyntheticSchemaRegistry();
  const metaOptions = withMeta ? { registry, meta: classes.PageMeta } : { registry };

  if (order === 'pages-first') {
    paginated(classes.CatDto, { registry });
    envelope(classes.OrderDto, metaOptions);
  } else {
    envelope(classes.OrderDto, metaOptions);
    paginated(classes.CatDto, { registry });
  }

  return normalizeOpenApiDocument(mergeSyntheticSchemas(hostDocument(), registry));
}

describe('synthetic schema names across builds, per T038', () => {
  it('should carry the synthetic schemas at all, so the empty diff below is about something', () => {
    // Given
    const document = build('pages-first', true);

    // When
    const names = [...document.schemas.keys()];

    // Then
    expect(names).toContain('PaginatedCatDto');
    expect(names).toContain('EnvelopeOrderDto');
  });

  it('should produce an empty diff between two builds registering in opposite order', () => {
    // Given two processes, fresh classes each, decorators running in a different order
    const first = build('pages-first', true);
    const second = build('envelopes-first', true);

    // When
    const report = buildDiffReport(first, second);

    // Then, no phantom breaking changes and no phantom changes at all
    expect(report.breaking).toEqual([]);
    expect(report.nonBreaking).toEqual([]);
  });

  it('should still see a real change in a synthetic schema, so the silence above is earned', () => {
    // Given a second build whose envelope actually changed: it gained a meta block
    const first = build('pages-first', false);
    const second = build('pages-first', true);

    // When
    const report = buildDiffReport(first, second);

    // Then, one optional property arrived on the envelope and nothing broke
    expect(report.breaking).toEqual([]);
    expect(report.nonBreaking).toEqual([
      {
        kind: 'optional-property-added',
        classification: 'non-breaking',
        subject: 'EnvelopeOrderDto.meta',
      },
    ]);
  });
});
