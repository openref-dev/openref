import { buildHealthReport, normalizeOpenApiDocument, type IRDocument } from '@openref/core';
import { describe, expect, it } from 'vitest';
import { renderPage } from '../../src/render/application/services/render.service';

/**
 * What a reader of the health page is shown for a finding, per SPEC 7.2.
 *
 * THREE DEFECTS MET A READER AT ONCE AND ALL THREE WERE INVISIBLE FROM INSIDE. `discovery-incomplete`
 * built its message as `${subject}: ${reason}` and its suggestion as the same `reason`, on the
 * reading that `openref doctor` prints the subject and the suggestion and never the message. It
 * does. Every browser theme prints the message and the suggestion one under the other and reads the
 * subject from neither, so the maintainer's health page showed one fifty word sentence twice per
 * finding, on five consecutive findings that were one cause on five handlers.
 *
 * THIS IS THE CASE THAT SEES IT, because it reads the markup rather than the model. Every unit test
 * of the rule, the model and the collectors was green on all three defects: each one held that its
 * own field carried the right string, and no case anywhere asked what the three strings look like
 * one under the other.
 */

/** Five handlers whose parameters the same cause left unread, which is what the reader saw. */
const CAUSE =
  'handlerScanCollector: a custom parameter decorator reads the request itself, so what the ' +
  'handler reads cannot be seen';

const SUBJECTS = [
  'FilterController.getProjects',
  'DashboardController.layout',
  'DashboardController.availableWidgets',
  'WidgetController.data',
  'CustomizationController.saveConfig',
];

/**
 * A document carrying one cause on five handlers, the way the runtime pass leaves it.
 *
 * @returns The document, with the health report a pass would have attached
 */
function fiveHandlers(): IRDocument {
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
        action:
          'nothing to do here: this route reports no unread parameters, and the finding is what ' +
          'says the row is unmeasured rather than clean',
        detail:
          'The factory behind a custom parameter decorator receives the whole execution context ' +
          'and may take anything out of it.',
      })),
    },
  };

  return { ...withProblems, health: buildHealthReport(withProblems) };
}

/**
 * One rule's disclosure out of the panel, from its own heading to the next rule's.
 *
 * @param markup - The rendered page
 * @param rule - The kebab id of the rule
 * @returns That group's markup alone
 */
function groupOf(markup: string, rule: string): string {
  const from = markup.indexOf(`id="oref-rule-${rule}"`);
  const rest = markup.slice(from);
  const next = rest.indexOf('id="oref-rule-', 1);

  return next === -1 ? rest : rest.slice(0, next);
}

describe('the health page, on the five findings that were one cause', () => {
  it('should print the cause once and the subject beside it, not inside it', async () => {
    // Given the document, rendered as a reader receives it
    const page = await renderPage(fiveHandlers(), { page: 'health' });

    // When, Then the sentence is on the page once. It was printed twice per finding: once as the
    // message with the subject glued to its front, and once bare as the suggested fix.
    const printed = page.appHtml.split(CAUSE).length - 1;
    expect(printed).toBe(1);
    expect(page.appHtml).not.toContain(`${SUBJECTS[0] ?? ''}: ${CAUSE}`);
  });

  it('should draw the subject of a finding that has no node to link to', async () => {
    // Given the same page. A handler is not an operation and has no page, so `driftModel` returned
    // the empty string for its subject and the reference theme, which draws the subject only when
    // there is a link, drew none at all. That is why the rule was gluing the subject onto its own
    // message: it was the only way the address reached the page.
    const page = await renderPage(fiveHandlers(), { page: 'health' });

    // When, Then every one of the five is named INSIDE the subject element rather than anywhere on
    // the page: at HEAD they were all on the page, glued to the front of the message, which is a
    // green this case must not accept.
    const group = groupOf(page.appHtml, 'discovery-incomplete');
    const named = [...group.matchAll(/oref-drift-subject"[^>]*>([^<]+)</g)].map(
      (match) => match[1],
    );
    expect(named).toEqual(SUBJECTS);
  });

  it('should fold the five into one row that carries the count and every subject', async () => {
    // Given the same page
    const page = await renderPage(fiveHandlers(), { page: 'health' });

    // When, Then there is one finding row for the five, it says how many it stands for, and the
    // five are under it. The subject is asserted present first: the rule really did produce five
    // findings, so one row is folding rather than dropping.
    const discovery =
      fiveHandlers().health?.drift.filter((issue) => issue.rule === 'discovery-incomplete') ?? [];
    expect(discovery).toHaveLength(5);

    const group = groupOf(page.appHtml, 'discovery-incomplete');
    expect(group.split('class="oref-drift ').length - 1).toBe(1);
    expect(group).toContain('>5 subjects<');
    expect(group).toContain('oref-drift-subjects');
  });

  it('should keep the reasoning on the page, closed, rather than deleting it', async () => {
    // Given the same page. Shortening the first line is not a licence to lose the argument: SPEC
    // 7.1 moves the reasoning into `detail` and the page opens it on request.
    const page = await renderPage(fiveHandlers(), { page: 'health' });

    // When, Then it is there, inside a disclosure, with no script and no inline style behind it
    expect(page.appHtml).toContain('receives the whole execution context');
    expect(page.appHtml).toContain('<details class="oref-drift-why">');
    expect(page.appHtml).not.toContain('style=');
  });

  it('should still say how many findings the rule produced, not how many rows it drew', async () => {
    // Given the same page. Folding answers "how many different things must I decide about"; the
    // heading answers "how much is wrong", and a panel that folded the heading too would have
    // hidden the volume it exists to report.
    const page = await renderPage(fiveHandlers(), { page: 'health' });

    // When, Then the rule heading carries five, which is the count of its findings and not the
    // one row they folded into
    const head = groupOf(page.appHtml, 'discovery-incomplete');
    expect(head.slice(0, head.indexOf('</summary>'))).toContain(
      '<span class="oref-rule-count">5</span>',
    );
  });
});
