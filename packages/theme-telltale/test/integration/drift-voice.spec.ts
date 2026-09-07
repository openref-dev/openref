import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildHealthReport, normalizeOpenApiDocument, type IRDocument } from '@openref/core';
import { describe, expect, it } from 'vitest';
import telltale from '../../src/theme';
import { createMarkdownRenderer } from '../../../render/src/markdown/domain/markdown';
import { renderPage } from '../../../render/src/render/application/services/render.service';

/**
 * The second theme draws the same three things the reference draws, per SPEC 7.2.
 *
 * WHY THIS IS A CASE AND NOT AN ASSUMPTION. `DriftModel` grew `subjects`, `count` and `detail`, and
 * a theme that reads only `subject` and `href` keeps compiling and quietly draws one subject of a
 * group of fifty four. That is the failure mode a second theme exists to catch, and it can only be
 * caught by rendering this theme rather than by reading its source.
 */

const markdown = await createMarkdownRenderer();

const CAUSE = 'handlerScanCollector: a custom parameter decorator reads the request itself';

const SUBJECTS = [
  'FilterController.getProjects',
  'DashboardController.layout',
  'WidgetController.data',
];

/**
 * A document carrying one cause on three handlers, the way the runtime pass leaves it.
 *
 * @returns The document, with the health report a pass would have attached
 */
function threeHandlers(): IRDocument {
  const base = normalizeOpenApiDocument({
    openapi: '3.1.0',
    info: { title: 'Analytics', version: '1.0.0' },
    paths: {
      '/filters/projects': {
        get: {
          operationId: 'FilterController_getProjects',
          summary: 'Projects',
          responses: { '200': { description: 'ok' } },
        },
      },
    },
  });

  const withProblems: IRDocument = {
    ...base,
    runtime: {
      collectors: ['handlerScanCollector'],
      problems: SUBJECTS.map((subject) => ({
        subject,
        reason: CAUSE,
        action: 'nothing to do here: no better instrument can see through the decorator',
        detail: 'The factory receives the whole execution context and may take anything from it.',
      })),
    },
  };

  return { ...withProblems, health: buildHealthReport(withProblems) };
}

describe('the telltale health page, on findings that are one cause', () => {
  it('should name every subject of a folded finding, not only the first', async () => {
    // Given the un-themed page first, which is the proof order this package holds to: without it,
    // "the theme drew the subjects" and "the page had none" are the same green
    const document = threeHandlers();
    const plain = (await renderPage(document, { markdown, page: 'health' })).appHtml;
    for (const subject of SUBJECTS) expect(plain).toContain(subject);

    // When the same page is drawn by this theme
    const themed = (await renderPage(document, { markdown, page: 'health', theme: telltale }))
      .appHtml;

    // Then all three are still named, under this theme's own class
    for (const subject of SUBJECTS) expect(themed).toContain(subject);
    expect(themed).toContain('tt-drift-subjects');
    expect(themed).toContain('3 subjects');
  });

  it('should print the cause once and keep the reasoning behind a disclosure', async () => {
    // Given the same document
    const themed = (
      await renderPage(threeHandlers(), { markdown, page: 'health', theme: telltale })
    ).appHtml;

    // When, Then the sentence is on the page once rather than once per finding and once again as
    // the fix, the reasoning is there and closed, and neither costs an inline style
    expect(themed.split(CAUSE).length - 1).toBe(1);
    expect(themed).toContain('<details class="tt-drift-why">');
    expect(themed).toContain('may take anything from it');
    expect(themed).not.toContain('style=');
  });

  it('should style both of the classes it draws, so neither is unpainted markup', () => {
    // Given this theme's own stylesheet, which is what a boundary arrival costs
    // When, Then. Read from the source rather than asserted from memory.
    const css = readFileSync(
      join(import.meta.dirname, '..', '..', 'src', 'styles', 'theme.css'),
      'utf8',
    );
    expect(css).toContain('.tt-drift-subjects');
    expect(css).toContain('.tt-drift-why');
  });
});
