import { buildHealthReport, hashDocument, normalizeOpenApiDocument } from '@openref/core';
import type { IRDocument, IRJsonValue } from '@openref/core';
import { describe, expect, it } from 'vitest';
import { renderPage } from '../../src/render/application/services/render.service';
import { buildHealthModel } from '../../src/page/domain/runtime-model';

/**
 * T025, the two extremes SPEC 7.2 and T023 were built for, measured rather than reasoned about.
 *
 * THE PANEL WAS BUILT FOR FOUR HUNDRED FINDINGS AND THIS IS WHERE THAT CLAIM IS CHECKED. The
 * finding was not that it becomes unreadable, because it does not: any number of findings is
 * still at most ten rules. It was that every one of them was serialized twice into a page whose
 * visible content is those ten rows closed.
 *
 * THE SECOND COPY IS GONE AND THIS FILE IS WHERE IT STAYS GONE. F43 is fixed by the panel
 * ceasing to be a client component: it has no state and no handler, so the state block carries
 * `healthRendered` and the markup carries the findings. What remains is the markup, and the
 * number below is what it costs, asserted rather than described so that a return of the copy is
 * a red build.
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
    expect(model?.rules.reduce((total, rule) => total + rule.findings.length, 0)).toBe(
      built.health?.drift.length,
    );
  });

  it('should serialize every finding once, as the markup a reader is looking at', async () => {
    // Given the same document, rendered as a reader receives it. The panel lives on the
    // health page since TX-FRAME, per SPEC 7.3, so the volume page is that one.
    const built = document(false);

    // When
    const page = await renderPage(built, { page: 'health' });

    // Then the findings are in the markup, and the state block says only that a panel is there.
    // The state block used to carry all 578 of them so a client render could rebuild markup that
    // was already on the page, and there is no client render: the disclosure is `details`.
    const first = built.health?.drift[0]?.message ?? '';
    expect(first).not.toBe('');
    expect(page.appHtml).toContain(first);
    expect(page.stateJson).not.toContain(first);
    expect(page.stateJson).toContain('"healthRendered":true');
    expect(page.stateJson).toContain('"health":null');

    // And the state block of the health page of a 578 finding document is under two
    // kilobytes, where it was 163,738 bytes. A single finding coming back reddens this; the
    // frame's tabs and stats are the growth over the old kilobyte.
    expect(Buffer.byteLength(page.stateJson, 'utf8')).toBeLessThan(2048);
  });

  it('should still cost what the markup costs, which is the number the maintainer decides on', async () => {
    // Given the same document. THIS ASSERTS THE REMAINING COST RATHER THAN A LIMIT THAT WAS MET:
    // 578 findings are 217 KB of markup inside four disclosures a reader has not opened, against
    // the SPEC 20 served-document ceiling of 72 KB. That ceiling is stated for the 1000 node
    // fixture and not for this document, so the comparison is an order of magnitude and not a
    // failed gate; the decision about whether a closed group ships its contents is SPEC 7.2's.
    const built = document(false);

    // When, on the page that carries the panel since TX-FRAME
    const page = await renderPage(built, { page: 'health' });

    // Then, and the band is wide enough to survive ordinary wording changes and narrow enough
    // that halving or doubling the markup reddens it
    const bytes =
      Buffer.byteLength(page.appHtml, 'utf8') + Buffer.byteLength(page.stateJson, 'utf8');
    expect(bytes).toBeGreaterThan(190_000);
    expect(bytes).toBeLessThan(240_000);
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

    // And the page a reader gets is a sixth of the drifting one
    const page = await renderPage(built);
    const bytes =
      Buffer.byteLength(page.appHtml, 'utf8') + Buffer.byteLength(page.stateJson, 'utf8');
    expect(bytes).toBeLessThan(50_000);
  });
});
