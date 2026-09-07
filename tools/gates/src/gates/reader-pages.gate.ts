import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PAGE_KIND_SOURCE, READER_PAGE_KINDS, READER_PAGES_PREFIX, SPEC_FILE } from '../config.js';
import { pageKindsOf } from '../lib/reader-pages.js';
import { PROJECTION_FILE, readProjection } from '../lib/projection.js';
import type { Gate, GateContext, GateFinding, GateResult } from '../types.js';

export { pageKindsOf, readerPagesOf } from '../lib/reader-pages.js';

/**
 * SPEC 13.3's reader page list and the `PageKind` union, reconciled in both directions.
 *
 * WHY IT IS A GATE AND NOT A TEST, in the words the section addressed to `T054` uses. A test
 * inside `packages/theme-telltale` cannot read `ai-docs/SPEC.md`, which is git excluded and absent
 * from every clone; the boundary count case next door already handles that by checking the two
 * committed documents always and the specification only when it is there. A gate is where the
 * other prose against code reconciliations in this repository live.
 *
 * IT USED TO SKIP ON EVERY CLONE AND NOW RUNS ON ONE. The routes SPEC 13.3 lists are routes, which
 * is data, so they travel in the committed projection of `ai-docs/` and both directions of the
 * reconciliation are asked wherever the gates run. What the specification says about them is not
 * in the artefact and is not needed: the check is which routes the line names.
 *
 * WHAT THIS GATE DELIBERATELY DOES NOT DO IS TIE EITHER SIDE TO THE SWEEP, because two total
 * records already do and a third copy is the failure mode this whole family of checks exists on.
 * `sweptPages()` is `Readonly<Record<PageKind, ...>>` and `PAGE_KIND_CARDINALITY` is a second one,
 * so a kind with no sweep entry and a kind with no build plan entry are both compile errors under
 * `pnpm lint`. This gate closes the one link neither of them can see.
 */
export function runReaderPagesGate(context: GateContext): GateResult {
  const findings: GateFinding[] = [];
  const errors: string[] = [];

  const kindSourcePath = join(context.repoRoot, PAGE_KIND_SOURCE);
  const declared = existsSync(kindSourcePath)
    ? pageKindsOf(readFileSync(kindSourcePath, 'utf8'))
    : null;

  // A CHECK THAT CANNOT DETERMINE ITS FACT SAYS SO RATHER THAN PASSING. A moved or renamed
  // declaration is exactly the state in which a text reader silently answers "no members", and
  // an empty union would make every reconciliation below vacuously true.
  if (declared === null) {
    errors.push(
      `[page-kind-unreadable] ${PAGE_KIND_SOURCE} does not declare a readable PageKind union, so ` +
        `neither direction of this reconciliation could be checked at all`,
    );
  }

  const mapped = new Map(READER_PAGE_KINDS.map((entry) => [entry.route, entry.kind]));

  if (declared !== null) {
    const union = new Set(declared);
    for (const entry of READER_PAGE_KINDS) {
      if (!union.has(entry.kind)) {
        errors.push(
          `[kind-not-declared] the reader page table maps ${entry.route} to the page kind ` +
            `"${entry.kind}", which ${PAGE_KIND_SOURCE} does not declare`,
        );
      }
    }

    const claimed = new Set(READER_PAGE_KINDS.map((entry) => entry.kind));
    for (const kind of declared) {
      if (!claimed.has(kind)) {
        errors.push(
          `[kind-unlisted] PageKind declares "${kind}" and no route of the reader page table ` +
            `names it, so a page a reader can open is described by no line of SPEC 13.3`,
        );
      }
    }

    findings.push({
      level: 'info',
      message: `PageKind declares ${String(declared.length)} member(s): ${declared.join(', ')}`,
    });
  }

  const read = readProjection(context.repoRoot);

  if (!read.ok) {
    errors.push(`[projection-unreadable] ${read.reason}`);
  } else {
    const routes = read.projection.data.spec.readerPages;

    if (routes === null) {
      errors.push(
        `[reader-pages-unreadable] ${SPEC_FILE} carries no section 13.3 reader page line behind ` +
          `"${READER_PAGES_PREFIX}", as read into ${PROJECTION_FILE}, so the direction this gate ` +
          `exists for could not be checked`,
      );
    } else {
      for (const route of routes) {
        if (!mapped.has(route)) {
          errors.push(
            `[route-unmapped] SPEC 13.3 lists the reader page ${route} and the reader page table ` +
              `maps no page kind to it, which is a page in the specification that no PageKind ` +
              `member serves and that no theme sweep can reach`,
          );
        }
      }

      for (const entry of READER_PAGE_KINDS) {
        if (!routes.includes(entry.route)) {
          errors.push(
            `[route-unlisted] the reader page table maps ${entry.route} to "${entry.kind}" and ` +
              `SPEC 13.3 does not list that route`,
          );
        }
      }

      findings.push({
        level: 'info',
        message: `SPEC 13.3 lists ${String(routes.length)} reader page(s): ${routes.join(' ')}`,
      });
    }
  }

  for (const message of errors) findings.push({ level: 'error', message });

  return {
    id: readerPagesGate.id,
    title: readerPagesGate.title,
    status: errors.length > 0 ? 'fail' : 'pass',
    findings,
  };
}

export const readerPagesGate: Gate = {
  id: 'reader-pages',
  title: 'SPEC 13.3 and the PageKind union name the same reader pages, in both directions',

  run(context): Promise<GateResult> {
    return Promise.resolve(runReaderPagesGate(context));
  },
};
