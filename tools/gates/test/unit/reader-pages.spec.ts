import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PAGE_KIND_SOURCE,
  READER_PAGE_KINDS,
  READER_PAGES_PREFIX,
  SPEC_FILE,
} from '../../src/config';
import {
  pageKindsOf,
  readerPagesOf,
  readerPagesGate,
  runReaderPagesGate,
} from '../../src/gates/reader-pages.gate';
import { aiDocsPresent } from '../../src/lib/ai-docs';
import { GATES } from '../../src/run';

const repoRoot = join(import.meta.dirname, '..', '..', '..', '..');

/**
 * The gate `T054` added, and the branches nothing ran until the second review of that task.
 *
 * WHAT ONLY A PLANTED TREE CAN PROVE. Every red class of this gate is a disagreement between two
 * files, and the committed tree agrees, which is what the gate is for; a suite that read only the
 * real repository could report the green path and nothing else. So the four disagreements are
 * planted in a temporary root and the gate is pointed at it, exactly as `budget-exceptions` and
 * `static-suites` plant theirs.
 *
 * AND THE TWO UNREADABLE BRANCHES ARE THE REASON THIS FILE EXISTS AT ALL. They carry the rule this
 * repository states in its own words, that a check which cannot determine its fact says so rather
 * than passing, and until now the only thing asserting they worked was that somebody had read them.
 */

let planted: string | undefined;

afterEach(() => {
  if (planted !== undefined) rmSync(planted, { recursive: true, force: true });
  planted = undefined;
});

/** The reader page line as SPEC 13.3 writes it, over the routes given. */
function specWith(routes: readonly string[]): string {
  return [
    '### 13.2. Что-то ещё',
    '',
    'Текст.',
    '',
    '### 13.3. Адресное пространство',
    '',
    `${READER_PAGES_PREFIX} ${routes.map((route) => `\`${route}\``).join(' · ')}`,
    '',
    '### 13.4. Дальше',
    '',
    'Текст.',
  ].join('\n');
}

/** The union as `packages/vue` declares it, over the members given. */
function unionWith(members: readonly string[]): string {
  return `export type PageKind = ${members.map((member) => `'${member}'`).join(' | ')};\n`;
}

/**
 * A repository root carrying only the two files this gate reads.
 *
 * @param options - What to write, each absent to leave the file out entirely
 * @returns Absolute path of the planted root
 */
function plant(options: { readonly spec?: string; readonly union?: string }): string {
  const root = mkdtempSync(join(tmpdir(), 'openref-reader-pages-'));
  planted = root;

  if (options.union !== undefined) {
    const target = join(root, PAGE_KIND_SOURCE);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, options.union);
  }

  if (options.spec !== undefined) {
    const target = join(root, SPEC_FILE);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, options.spec);
  }

  return root;
}

/** Every rule id the gate reported, in order. */
function rulesOf(root: string): string[] {
  return runReaderPagesGate({ repoRoot: root })
    .findings.filter((finding) => finding.level === 'error')
    .map((finding) => /^\[([a-z-]+)\]/.exec(finding.message)?.[1] ?? '?');
}

const ALL_KINDS = READER_PAGE_KINDS.map((entry) => entry.kind);
const ALL_ROUTES = READER_PAGE_KINDS.map((entry) => entry.route);

describe('readerPagesOf', () => {
  it('should read the routes out of the section 13.3 line by their backticks', () => {
    // Given the shape the specification writes: a Russian label, then routes separated by a dot
    // When
    const routes = readerPagesOf(specWith(['<route>', '<route>/health']));

    // Then
    expect(routes).toEqual(['<route>', '<route>/health']);
  });

  it('should answer null when section 13.3 is not there at all', () => {
    // Given a specification the section was renumbered out of. An empty list would reconcile with
    // every entry of the table, which is a proof of absence passing because the subject is absent.
    // When
    const routes = readerPagesOf('### 13.4. Что-то\n\nТекст.\n');

    // Then
    expect(routes).toBeNull();
  });

  it('should answer null when the section is there and carries no reader page line', () => {
    // Given
    const routes = readerPagesOf('### 13.3. Адресное пространство\n\nСписок переехал.\n');

    // When, Then
    expect(routes).toBeNull();
  });

  it('should stop at the next section rather than reading the one below', () => {
    // Given a document whose 13.4 also carries a line behind the same prefix
    const spec = [
      '### 13.3. Адресное пространство',
      '',
      `${READER_PAGES_PREFIX} \`<route>\``,
      '',
      '### 13.4. Дальше',
      '',
      `${READER_PAGES_PREFIX} \`<route>/nowhere\``,
    ].join('\n');

    // When, Then
    expect(readerPagesOf(spec)).toEqual(['<route>']);
  });
});

describe('pageKindsOf', () => {
  it('should read the members out of the union declaration', () => {
    // Given, When
    const kinds = pageKindsOf(unionWith(['overview', 'node']));

    // Then
    expect(kinds).toEqual(['overview', 'node']);
  });

  it('should answer null when the declaration is not there to read', () => {
    // Given the state a renamed or moved union produces, which is exactly when a text reader
    // silently answers "no members" and makes every reconciliation vacuously true
    // When
    const kinds = pageKindsOf('export type SomethingElse = string;\n');

    // Then
    expect(kinds).toBeNull();
  });

  it('should answer null for a declaration with no string member in it', () => {
    // Given
    const kinds = pageKindsOf('export type PageKind = string;\n');

    // When, Then
    expect(kinds).toBeNull();
  });

  it('should read the real union this repository ships', () => {
    // Given the committed file, so the parser is held to the shape it actually meets rather than
    // to the shape this suite writes
    const source = readFileSync(join(repoRoot, PAGE_KIND_SOURCE), 'utf8');

    // When
    const kinds = pageKindsOf(source);

    // Then
    expect(kinds).toEqual(ALL_KINDS);
  });
});

describe('the reader pages gate', () => {
  it('should be silent when the specification, the union and the table all agree', () => {
    // Given a planted tree in the state the committed one is in
    const root = plant({ spec: specWith(ALL_ROUTES), union: unionWith(ALL_KINDS) });

    // When
    const result = runReaderPagesGate({ repoRoot: root });

    // Then, and the info findings are asserted too, because a gate that read neither file would
    // also report no errors
    expect(result.status).toBe('pass');
    expect(result.findings.filter((finding) => finding.level === 'error')).toEqual([]);
    expect(result.findings.map((finding) => finding.message).join(' ')).toContain(
      `PageKind declares ${String(ALL_KINDS.length)} member(s)`,
    );
  });

  it('should say the union is unreadable rather than reconciling with nothing', () => {
    // Given the branch this whole file exists for: the declaration moved, so neither direction of
    // the reconciliation can be checked and an empty union would make both of them vacuous
    const root = plant({ spec: specWith(ALL_ROUTES), union: 'export type Other = string;\n' });

    // When, Then
    expect(rulesOf(root)).toEqual(['page-kind-unreadable']);
  });

  it('should say the same when the union file is not on disk at all', () => {
    // Given
    const root = plant({ spec: specWith(ALL_ROUTES) });

    // When, Then the file really is absent, so the branch under test is the one that fired
    expect(existsSync(join(root, PAGE_KIND_SOURCE))).toBe(false);
    expect(rulesOf(root)).toEqual(['page-kind-unreadable']);
  });

  it('should say the reader page line is unreadable rather than passing on a present document', () => {
    // Given the other unreadable branch: `ai-docs/` is there, the specification is there, and the
    // line the gate reads is not. Reporting nothing here would be an absent list reading as
    // agreement, which is the failure the whole family of these checks is against.
    const root = plant({
      spec: '### 13.3. Адресное пространство\n\nСписок переехал.\n',
      union: unionWith(ALL_KINDS),
    });

    // When, Then
    expect(rulesOf(root)).toEqual(['reader-pages-unreadable']);
  });

  it('should fail on a route the specification lists and the table maps to no kind', () => {
    // Given a page added to SPEC 13.3 and to nothing else, which is how `shapes`, `states` and
    // `service` each arrived
    const root = plant({
      spec: specWith([...ALL_ROUTES, '<route>/timeline']),
      union: unionWith(ALL_KINDS),
    });

    // When, Then
    expect(rulesOf(root)).toEqual(['route-unmapped']);
  });

  it('should fail on a route the table maps and the specification does not list', () => {
    // Given the reverse: a mapping for an address the document no longer serves
    const root = plant({ spec: specWith(ALL_ROUTES.slice(1)), union: unionWith(ALL_KINDS) });

    // When, Then
    expect(rulesOf(root)).toEqual(['route-unlisted']);
  });

  it('should fail on a kind the table names that the union does not declare', () => {
    // Given a union that lost a member the reader page table still maps a route to
    const root = plant({ spec: specWith(ALL_ROUTES), union: unionWith(ALL_KINDS.slice(1)) });

    // When, Then. The first entry's kind is gone from the union, and its route is still listed by
    // the specification, so both directions of that one row report.
    expect(rulesOf(root).sort()).toEqual(['kind-not-declared']);
  });

  it('should fail on a kind the union declares that no route of the table names', () => {
    // Given the direction no total record in the tree can see: a member added to `PageKind` with
    // no line of SPEC 13.3 describing the page it serves
    const root = plant({
      spec: specWith(ALL_ROUTES),
      union: unionWith([...ALL_KINDS, 'timeline']),
    });

    // When, Then
    expect(rulesOf(root)).toEqual(['kind-unlisted']);
  });

  it('should skip rather than pass where the specification is not in the checkout', () => {
    // Given a tree with the union and no `ai-docs/` at all, which is every clone but one
    const root = plant({ union: unionWith(ALL_KINDS) });

    // When
    const result = runReaderPagesGate({ repoRoot: root });

    // Then it says so and names the reason, and the half that needs no document still ran: the
    // union was read and reconciled with the table, which is what the info finding reports.
    expect(aiDocsPresent(root)).toBe(false);
    expect(result.status).toBe('skip');
    expect(result.skipReason).toBe('ai-docs-absent');
    expect(result.findings.map((finding) => finding.message).join(' ')).toContain(
      'THE SKIP COVERS THE SPECIFICATION HALF ONLY',
    );
    expect(result.findings.filter((finding) => finding.level === 'error')).toEqual([]);
  });

  it('should go on failing on a disagreement with the directory absent', () => {
    // Given the same checkout with the half that needs no document broken. A skip here would be
    // an absence reading as coverage, which is the thing the skip accounting exists to refuse.
    const root = plant({ union: unionWith([...ALL_KINDS, 'timeline']) });

    // When
    const result = runReaderPagesGate({ repoRoot: root });

    // Then
    expect(result.status).toBe('fail');
    expect(rulesOf(root)).toEqual(['kind-unlisted']);
  });

  it('should pass on the committed tree, which is the reading that can go stale', () => {
    // Given the real repository. This is the case that fails the day somebody adds a page to the
    // specification, or a member to the union, and stops there.
    const result = runReaderPagesGate({ repoRoot });

    // When, Then. On a checkout with the documents it passes; on one without them it skips, and
    // either way it reports no error, which is the assertion that holds in both places.
    expect(result.findings.filter((finding) => finding.level === 'error')).toEqual([]);
    expect(result.status).toBe(aiDocsPresent(repoRoot) ? 'pass' : 'skip');
  });

  it('should be registered in the run, after the M6 suites gate', () => {
    // Given the committed order
    const order = GATES.map((gate) => gate.id);

    // When
    const position = order.indexOf(readerPagesGate.id);

    // Then it is in the run at all, and it sits with the other document reconciliations rather
    // than after the gate that runs the whole suite
    expect(position).toBeGreaterThan(-1);
    expect(order[position - 1]).toBe('m6-suites');
    expect(order.indexOf('coverage')).toBe(order.length - 1);
  });
});
