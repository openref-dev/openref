import { buildHealthReport, hashDocument, normalizeOpenApiDocument } from '@openref/core';
import type { IRDocument, IRJsonValue } from '@openref/core';
import { describe, expect, it } from 'vitest';
import { renderPage } from '../../src/render/application/services/render.service';
import { buildHealthModel } from '../../src/page/domain/runtime-model';

/**
 * T025, the two extremes SPEC 7.2 and T023 were built for, measured rather than reasoned about.
 *
 * THE PANEL WAS BUILT FOR FOUR HUNDRED FINDINGS AND THIS IS WHERE THAT CLAIM IS CHECKED. The
 * finding is not that it becomes unreadable, because it does not: any number of findings is still
 * at most ten rules. It is that every one of them is serialized twice into a page whose visible
 * content is those ten rows closed.
 */

/** A document of the shape a real application produced: 73 operations, findings in the hundreds. */
function specification(described: boolean): Record<string, IRJsonValue> {
  const paths: Record<string, IRJsonValue> = {};

  for (let index = 0; index < 73; index += 1) {
    const content: IRJsonValue = described
      ? {
          'application/json': {
            schema: { $ref: '#/components/schemas/Thing' },
            example: { field0: 'a' },
          },
        }
      : { 'application/json': { schema: { $ref: '#/components/schemas/Thing' } } };

    paths[`/resource-${String(index)}`] = {
      get: {
        operationId: `Controller${String(index)}_list`,
        ...(described ? { description: 'Lists the things this resource holds.' } : {}),
        responses: { '200': { description: 'ok', content } },
      },
    };
  }

  const properties: Record<string, IRJsonValue> = {};
  for (let field = 0; field < 359; field += 1) {
    properties[`field${String(field)}`] = described
      ? { type: 'string', description: 'A field.' }
      : { type: 'string' };
  }

  return {
    openapi: '3.1.0',
    info: { title: 'an application of the size that found this', version: '1.0.0' },
    paths,
    components: { schemas: { Thing: { type: 'object', properties } } },
  };
}

function document(described: boolean): IRDocument {
  const normalized = normalizeOpenApiDocument(specification(described));
  const withReport: IRDocument = { ...normalized, health: buildHealthReport(normalized), hash: '' };

  return { ...withReport, hash: hashDocument(withReport) };
}

describe('T025 attack: an application where nearly every operation drifts', () => {
  it('should keep the panel to one row per rule, however many findings there are', () => {
    // Given the document that produced 578 findings
    const built = document(false);

    // When
    const model = buildHealthModel(built, '');

    // Then a reader scans four lines and no group is truncated, which is what T023 promised
    expect(built.health?.drift.length).toBeGreaterThan(500);
    expect(model?.rules).toHaveLength(4);
    expect(
      model?.rules.reduce((total, rule) => total + rule.findings.length, 0),
    ).toBe(built.health?.drift.length);
  });

  it('should show that every finding is serialized twice into the overview page', async () => {
    // Given the same document, rendered as a reader receives it. THIS IS THE FINDING RATHER THAN
    // AN ASSERTION ABOUT A LIMIT: the findings are in the SSR markup, inside a `details` nobody has
    // opened, and again in the state JSON so the client can hydrate the same closed disclosure.
    const built = document(false);

    // When
    const page = await renderPage(built);

    // Then both copies are there, which is the shape SPEC 7.2 records as accepted for now
    const first = built.health?.drift[0]?.message ?? '';
    expect(first).not.toBe('');
    expect(page.appHtml).toContain(first);
    expect(page.stateJson).toContain(first);

    // And the page is several times the SPEC 20 served-document ceiling, which is the cost
    const bytes = Buffer.byteLength(page.appHtml, 'utf8') + Buffer.byteLength(page.stateJson, 'utf8');
    expect(bytes).toBeGreaterThan(300_000);
  });
});

describe('T025 attack: an application with nothing left to report', () => {
  it('should not invent work, and should still say what a generated operationId costs', async () => {
    // Given the same 73 operations with every description, example and field description written.
    // The question is whether the panel finds something to say anyway.
    const built = document(true);

    // When
    const rules = buildHealthModel(built, '')?.rules ?? [];

    // Then one rule remains, and it is not invented: SPEC 7.1 treats the `Controller_list` id
    // `@nestjs/swagger` generates as the generator's rather than the author's. THE MESSAGE HAD TO
    // CHANGE FOR THAT TO BE HONEST: it used to say the specification gives the operation no stable
    // operationId while printing that operationId beside it as the specification's value.
    expect(rules.map((rule) => rule.rule)).toEqual(['missing-operation-id']);
    expect(rules[0]?.findings[0]?.message).toContain('the generator produced');
    expect(rules[0]?.findings[0]?.sides).toContain('OpenAPI: Controller0_list');

    // And the page a reader gets is a seventh of the drifting one
    const page = await renderPage(built);
    const bytes = Buffer.byteLength(page.appHtml, 'utf8') + Buffer.byteLength(page.stateJson, 'utf8');
    expect(bytes).toBeLessThan(100_000);
  });
});
