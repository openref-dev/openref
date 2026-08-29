import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PAGE_KIND_SOURCE, READER_PAGE_KINDS, READER_PAGES_PREFIX, SPEC_FILE } from '../config.js';
import { AI_DOCS_DIR, aiDocsPresent } from '../lib/ai-docs.js';
import type { Gate, GateContext, GateFinding, GateResult } from '../types.js';

/**
 * The routes SPEC 13.3 lists as reader pages, read out of the specification's own line.
 *
 * THE LINE IS FOUND BY ITS PREFIX AND THE ENTRIES BY THEIR BACKTICKS, which is how the document
 * writes them: one line, a Russian label, then the routes separated by a middle dot and each one
 * in code. Reading the backticked spans rather than splitting on the separator is what keeps a
 * changed separator from silently producing one long entry that matches nothing.
 *
 * @param spec - Full text of `ai-docs/SPEC.md`
 * @returns The routes, or null when section 13.3 or its reader page line is absent
 */
export function readerPagesOf(spec: string): string[] | null {
  const section = /^### 13\.3\. /m.exec(spec);
  if (section === null) return null;

  const rest = spec.slice(section.index);
  const end = /^#{2,3} \d+/m.exec(rest.slice(section[0].length));
  const body = end === null ? rest : rest.slice(0, section[0].length + end.index);

  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(READER_PAGES_PREFIX)) continue;

    const routes = [...trimmed.matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? '');
    return routes.filter((route) => route !== '');
  }

  return null;
}

/**
 * The members of the `PageKind` union, read out of its declaration.
 *
 * @param source - Full text of the file that declares it
 * @returns The members, or null when the declaration is not there to read
 */
export function pageKindsOf(source: string): string[] | null {
  const declaration = /export type PageKind =([^;]*);/.exec(source);
  if (declaration === null) return null;

  const members = [...(declaration[1] ?? '').matchAll(/'([^']+)'/g)].map((match) => match[1] ?? '');
  return members.length === 0 ? null : members;
}

/**
 * SPEC 13.3's reader page list and the `PageKind` union, reconciled in both directions.
 *
 * WHY IT IS A GATE AND NOT A TEST, in the words the section addressed to `T054` uses. A test
 * inside `packages/theme-telltale` cannot read `ai-docs/SPEC.md`, which is git excluded and absent
 * from every clone; the boundary count case next door already handles that by checking the two
 * committed documents always and the specification only when it is there. A gate runs on the
 * maintainer's tree where the specification exists, has the `ai-docs-absent` skip built for
 * exactly this, and is where the other prose against code reconciliations in this repository live.
 *
 * THE HALF THAT NEEDS NO DOCUMENT STILL RUNS ON A CLONE. `READER_PAGE_KINDS` names kinds, and
 * whether every one of them is a member of the union is a question about two committed files, so
 * it is asked whether or not `ai-docs/` is there. What the skip covers is the specification half
 * alone, which is the direction the section says must be real: a page added to SPEC 13.3 with no
 * `PageKind` member fails, and that comparison needs the document.
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

  const specPath = join(context.repoRoot, SPEC_FILE);
  const haveSpec = aiDocsPresent(context.repoRoot) && existsSync(specPath);

  if (haveSpec) {
    const routes = readerPagesOf(readFileSync(specPath, 'utf8'));

    if (routes === null) {
      errors.push(
        `[reader-pages-unreadable] ${SPEC_FILE} carries no section 13.3 reader page line behind ` +
          `"${READER_PAGES_PREFIX}", so the direction this gate exists for could not be checked`,
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
  } else {
    findings.push({
      level: 'warning',
      message:
        `SKIPPED, NOT PASSED, AND THE SKIP COVERS THE SPECIFICATION HALF ONLY: ${AI_DOCS_DIR}/ is ` +
        `not present, so SPEC 13.3's reader page list was not compared with the PageKind union ` +
        `and this run proves nothing about that document. The half that reads two committed ` +
        `files still ran and can still fail: every page kind the reader page table names must be ` +
        `a member of the union, and every member of the union must be named by it. ` +
        `${AI_DOCS_DIR}/ is excluded from git in .git/info/exclude and no clone restores it, so ` +
        `a checkout without it is expected rather than broken.`,
    });
  }

  for (const message of errors) findings.push({ level: 'error', message });

  return {
    id: readerPagesGate.id,
    title: readerPagesGate.title,
    ...(errors.length > 0
      ? { status: 'fail' as const }
      : haveSpec
        ? { status: 'pass' as const }
        : { status: 'skip' as const, skipReason: 'ai-docs-absent' as const }),
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
