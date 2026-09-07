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

    // Then a reader scans four lines, no group is truncated, and the rows inside a group are its
    // causes rather than its findings, per SPEC 7.2. The heading still carries the finding count,
    // because how much is wrong and how many different things to decide about are two questions a
    // reader asks and the panel answers both.
    expect(built.health?.drift.length).toBeGreaterThan(500);
    expect(model?.rules).toHaveLength(4);
    expect(model?.rules.map((rule) => rule.count).map(Number)).toEqual([73, 73, 359, 73]);
    expect(model?.rules.reduce((total, rule) => total + Number(rule.count), 0)).toBe(
      built.health?.drift.length,
    );

    // And every subject is still named: 578 findings fold to 76 rows and the rows between them
    // carry 578 subjects, so folding hid nothing. WHAT USED TO HAPPEN: one sentence per subject,
    // 578 rows, of which 359 were `dto-field-undescribed` printing the same sentence 359 times.
    const rows = model?.rules.flatMap((rule) => rule.findings) ?? [];
    expect(rows).toHaveLength(76);
    expect(rows.reduce((total, row) => total + row.subjects.length, 0)).toBe(
      built.health?.drift.length,
    );
    expect(rows.reduce((total, row) => total + Number(row.count), 0)).toBe(
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
    // Given the same document. THIS ASSERTS THE REMAINING COST RATHER THAN A LIMIT THAT WAS MET.
    // It read 190 to 240 KB while every finding was its own row: 578 sentences inside four
    // disclosures a reader has not opened, against the SPEC 20 served-document ceiling of 72 KB.
    // Folding by cause, per SPEC 7.2, took the same page to 86 KB, because 359 copies of one
    // `dto-field-undescribed` sentence became one sentence and 359 links. The ceiling is stated
    // for the 1000 node fixture and not for this document, so the comparison is an order of
    // magnitude and not a failed gate, and the page is still over it.
    const built = document(false);

    // When, on the page that carries the panel since TX-FRAME
    const page = await renderPage(built, { page: 'health' });

    // Then, and the band is wide enough to survive ordinary wording changes and narrow enough
    // that halving or doubling the markup reddens it
    const bytes =
      Buffer.byteLength(page.appHtml, 'utf8') + Buffer.byteLength(page.stateJson, 'utf8');
    expect(bytes).toBeGreaterThan(70_000);
    expect(bytes).toBeLessThan(110_000);
  });
});

describe('T025 attack: an application with nothing left to report', () => {
  it('should not invent work, and should still say what a generated operationId costs', async () => {
    // Given the same 73 operations with every description, example and field description written.
    // The question is whether the panel finds something to say anyway.
    const built = document(true);

    // When
    const rules = buildHealthModel(built, '')?.rules ?? [];

    // Then one loud rule remains, and it is not invented: SPEC 7.1 treats the `Controller_list`
    // id `@nestjs/swagger` generates as the generator's rather than the author's. THE MESSAGE HAD
    // TO CHANGE FOR THAT TO BE HONEST: it used to say the specification gives the operation no
    // stable operationId while printing that operationId beside it as the specification's value.
    // The rules that examined and stayed quiet follow as zero rows since TX-PARITY-UI, which is
    // the panel saying they looked, not the panel inventing work.
    const loud = rules.filter((rule) => rule.findings.length > 0);
    expect(loud.map((rule) => rule.rule)).toEqual(['missing-operation-id']);
    expect(loud[0]?.findings[0]?.message).toContain('the generator produced');
    expect(loud[0]?.findings[0]?.sides).toContain('OpenAPI: Controller0_list');
    expect(
      rules.filter((rule) => rule.findings.length === 0).every((rule) => rule.count === '0'),
    ).toBe(true);

    // And the page a reader gets is a sixth of the drifting one
    const page = await renderPage(built);
    const bytes =
      Buffer.byteLength(page.appHtml, 'utf8') + Buffer.byteLength(page.stateJson, 'utf8');
    expect(bytes).toBeLessThan(50_000);
  });
});
