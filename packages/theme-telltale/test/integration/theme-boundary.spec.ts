import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { IRDocument } from '@openref/core';
import type { PageKind } from '@openref/vue';
import telltale from '../../src/theme';
import {
  entryHref,
  nodeHref,
  overviewHref,
  schemaHref,
  RESERVED_MOUNT_SEGMENTS as THEME_RESERVED,
} from '../../src/links';
import {
  eventFile as themeEventFile,
  eventValue as themeEventValue,
  type FileEvent as ThemeFileEvent,
  type PickedFile as ThemePickedFile,
  type ValueEvent as ThemeValueEvent,
} from '../../src/dom';
import {
  SERVICE_ID,
  apiDocument,
  channelNodeIds,
  eventsDocument,
  federatedDocument,
  nodeId,
  postNodeId,
  runtimeDocument,
  topologyDocument,
} from '../mocks/documents';
import { createMarkdownRenderer } from '../../../render/src/markdown/domain/markdown';
import {
  nodeHref as referenceNodeHref,
  overviewHref as referenceOverviewHref,
  schemaHref as referenceSchemaHref,
  RESERVED_MOUNT_SEGMENTS as REFERENCE_RESERVED,
} from '../../../render/src/page/domain/links';
import {
  eventFile as referenceEventFile,
  eventValue as referenceEventValue,
  type FileEvent as ReferenceFileEvent,
  type PickedFile as ReferencePickedFile,
  type ValueEvent as ReferenceValueEvent,
} from '../../../render/src/shared/dom';
import { renderPage } from '../../../render/src/render/application/services/render.service';

/**
 * Where this theme ends and the reference begins, measured rather than argued.
 *
 * THIS FILE IS THE DELIVERABLE OF T032 AS MUCH AS THE THEME IS. The task exists to prove the theme
 * contract is real, and a proof that comes back partly negative is a result. `THEME-BOUNDARY.md`
 * beside the package README says what each of these means and who owns it; this file is what stops
 * the answer drifting without anybody noticing.
 *
 * NOTHING HERE IS WORKED AROUND. Every case pins a fact about the boundary as it is, so that the
 * task that changes the boundary sees these go red and has to read them.
 */

const markdown = await createMarkdownRenderer();

const packageRoot = join(import.meta.dirname, '..', '..');

/**
 * True only while each of two declarations describes the other, decided by the compiler.
 *
 * A transcribed type is a copy with no link back to its origin, so the only thing that can hold
 * the two together is a place where both are named at once and the compiler is asked. `false`
 * rather than `never`, so the failure is a readable type error at the assignment and not a
 * cascade of unrelated ones.
 */
type Mutual<TLeft, TRight> = [TLeft] extends [TRight]
  ? [TRight] extends [TLeft]
    ? true
    : false
  : false;

/** Which page of a document one render of the sweep asks for. */
interface SweepWhere {
  readonly page?: PageKind;
  readonly nodeId?: string;
  readonly schemaId?: string;
  readonly serviceId?: string;
}

/** One render of the sweep: a document and the page of it to draw. */
interface SweepRender {
  readonly document: IRDocument;
  readonly where: SweepWhere;
}

/**
 * How the sweep reaches one page kind: the renders that produce it, or why it makes none.
 *
 * A REASON IS A SENTENCE SOMEBODY WROTE, which is the whole difference between a kind left out
 * and a kind forgotten. There is no excluded kind today, and the arm exists so that leaving one
 * out costs a sentence rather than a deletion, exactly as `PAGE_KIND_CARDINALITY` in
 * `@openref/static` keeps the word `never` for a page a build deliberately does not write.
 */
type SweptKind = readonly SweepRender[] | { readonly excluded: string };

/**
 * Every kind of reader page, with the renders that reach it. Total over `PageKind`.
 *
 * BOUND TO THE UNION RATHER THAN KEPT BY HAND, 2026-08-29, by the maintainer's ruling and for the
 * reason the union's three other lists were bound before M4: a kind added to `PageKind` compiled
 * against a hand written list without appearing in it, so a whole page shipped outside this sweep
 * with its class names on no list and this theme styling none of them. That happened twice. The
 * service card of SPEC 15.3 was the first, found by the pre-M5 cleanup; the shapes and states
 * pages were the second, found by the pre-`T049` slice, eighteen names between them. This record
 * does not compile until a new kind is placed, so the third one cannot happen quietly.
 *
 * THE HEALTH PAGE IS RENDERED FROM THE DOCUMENT WITH AN APPLICATION BEHIND IT, because the panel
 * is drawn only when there is a report, and a sweep that missed it would report a smaller boundary
 * than the one that exists. `node` and `bench` are each rendered twice because the two mock
 * documents put different sections on them.
 *
 * @returns The renders of every page kind, keyed by kind
 */
function sweptPages(): Readonly<Record<PageKind, SweptKind>> {
  const api = apiDocument();
  const runtime = runtimeDocument();
  const events = eventsDocument();

  return {
    // TWO RENDERS, AND THE SECOND IS THE GRAPH. The topology section of `T052` is drawn on this
    // kind and on no other, so without a document that declares edges every class it emits would
    // be on no list and styled by no rule, which is the failure this record exists to prevent met
    // from the direction the union cannot report: the kind was already swept and the markup is
    // new. `topologyDocument` carries a dead end and an inferred edge on purpose, because those
    // are the two states the section draws differently and neither is something a normalizer
    // produces.
    overview: [
      { document: runtime, where: {} },
      { document: topologyDocument(), where: {} },
    ],
    // FOUR RENDERS, AND THE LAST TWO ARE CHANNELS. A channel is a node, so its page is this kind
    // and the record above cannot see that a whole family of markup arrived with `T050`; the
    // other two renders are both OpenAPI, so without this one every class the channel sections
    // emit would be on no list and styled by no rule, which is the failure this record exists to
    // prevent, met from a direction the union cannot report.
    node: [
      { document: runtime, where: { nodeId: nodeId() } },
      { document: api, where: { nodeId: postNodeId() } },
      { document: events, where: { nodeId: channelNodeIds()[0] } },
      { document: events, where: { nodeId: channelNodeIds()[1] } },
    ],
    schema: [{ document: api, where: { schemaId: 'Order' } }],
    bench: [
      { document: api, where: { page: 'bench', nodeId: postNodeId() } },
      { document: runtime, where: { page: 'bench', nodeId: nodeId() } },
    ],
    health: [{ document: runtime, where: { page: 'health' } }],
    // THREE RENDERS, AND THE SECOND AND THIRD ARE THE READING ROWS `Order` CANNOT DRAW. `T054`
    // added them: this kind was swept from the pre `T049` slice onward and the sweep still missed
    // THIRTEEN class names, because the schema it renders is a flat object and the rows for a
    // variant, a conditional requirement, a pattern key and an empty body are drawn only for input
    // no fixture carried. Four kinds of row, thirteen names; the count said five until the
    // post-`T054` review read it against the pin below, and none of the thirteen is markup `T054`
    // wrote, since `packages/render/src` emitted every one of them already. A total record over
    // `PageKind` cannot report that, because the missing thing is not a page.
    shapes: [
      { document: api, where: { page: 'shapes', schemaId: 'Order' } },
      { document: api, where: { page: 'shapes', schemaId: 'Payment' } },
      { document: api, where: { page: 'shapes', schemaId: 'Empty' } },
    ],
    states: [{ document: api, where: { page: 'states' } }],
    service: [{ document: federatedDocument(), where: { page: 'service', serviceId: SERVICE_ID } }],
  };
}

/** How many renders the sweep makes in total, which is the figure the handoff states in prose. */
function sweptRenderCount(): number {
  return Object.values(sweptPages()).reduce(
    (total, entry) => total + ('excluded' in entry ? 0 : entry.length),
    0,
  );
}

/** This theme's own stylesheet, read once so the two cases that scan it cannot read two files. */
function themeStylesheet(): string {
  return readFileSync(join(packageRoot, 'src', 'styles', 'theme.css'), 'utf8');
}

/**
 * Which of the surviving names this theme carries a rule for.
 *
 * ONE DEFINITION FOR TWO CASES. The styling case below asserts which name is deliberately left
 * alone, and the count case asserts the handoff states the same total; two copies of the filter
 * would let those two answers drift apart, which is the class of defect this whole file is about.
 *
 * @param surviving - The class names that outlive every override
 * @param css - This theme's stylesheet
 * @returns The subset carrying a rule here
 */
function styledHere(surviving: readonly string[], css: string): readonly string[] {
  return surviving.filter((name) => css.includes(`.${name}`));
}

/**
 * Every `oref-` literal the renderer's own sources carry, split by SPEC 10.4's rule.
 *
 * THE RULE IS THE SPECIFICATION'S AND IS APPLIED HERE RATHER THAN PARAPHRASED: a literal ending in
 * a hyphen is a runtime prefix and everything else is a name a page can carry. It is applied to
 * `packages/render/src` because that is where the reference's markup is written; this theme reads
 * those sources already, three imports up.
 *
 * @returns The literals, the runtime prefixes and the names
 */
function emittedCoreClasses(): {
  readonly literals: readonly string[];
  readonly prefixes: readonly string[];
  readonly names: readonly string[];
  readonly files: number;
} {
  const root = join(packageRoot, '..', 'render', 'src');
  const found = new Set<string>();
  let files = 0;

  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!entry.name.endsWith('.ts')) continue;

      files += 1;
      for (const match of readFileSync(path, 'utf8').matchAll(/oref-[a-z0-9-]*/g)) {
        found.add(match[0]);
      }
    }
  };

  walk(root);

  const literals = [...found].sort();

  return {
    literals,
    prefixes: literals.filter((literal) => literal.endsWith('-')),
    names: literals.filter((literal) => !literal.endsWith('-')),
    files,
  };
}

/** Class names from the reference's own namespace that survive a complete L2 theme. */
async function survivingCoreClasses(): Promise<readonly string[]> {
  const found = new Set<string>();

  for (const swept of Object.values(sweptPages())) {
    if ('excluded' in swept) continue;

    for (const page of swept) {
      const rendered = await renderPage(page.document, {
        ...page.where,
        markdown,
        theme: telltale,
      });

      for (const match of rendered.appHtml.matchAll(/class="([^"]*)"/g)) {
        for (const name of (match[1] ?? '').split(/\s+/)) {
          if (name.startsWith('oref-')) found.add(name);
        }
      }
    }
  }

  return [...found].sort();
}

describe('the markup a complete L2 theme does not own', () => {
  it('should be exactly these class names, on the eight kinds of page a reader can open', async () => {
    // Given a theme that fills all 21 positions of the frozen registry and writes its own
    // stylesheet, which is what SPEC 10.1 calls a level 2 theme: "a package with its own layout;
    // the core contributes no styles".
    // When
    const surviving = await survivingCoreClasses();

    // Then the core contributes markup, under its own class names, that this theme did not write
    // and cannot replace. The list is pinned rather than counted so that a name arriving or
    // leaving is read rather than absorbed.
    // `oref-node-columns`, `oref-column-spec` and `oref-column-runtime` left this list with
    // TX-GUTTER: the page-level columns are gone from the reference, the spec and runtime pair
    // exists only inside a parity row, and the parity markup itself lives in the `RuntimePanel`
    // position, which this theme overrides, so no parity class arrives to survive.
    // `oref-bench-page`, `oref-health-page`, `oref-operation-header` and `oref-title` arrived
    // with TX-FRAME: the two new pages are articles the reference draws outside every position,
    // and the bench head is the reference's own two classes. The boundary widened, and this
    // list is where that fact is read instead of absorbed.
    // ELEVEN ARRIVED WITH TX-PARITY-UI, 2026-08-14, all page furniture outside every position:
    // the bench head's kicker, badge and path (`oref-bench-kicker`, `oref-badge`,
    // `oref-endpoint`, `oref-path`, and the badge's generated `oref-method-*` family), the
    // bench's actions row with Reset and the chord hint (`oref-bench-actions`,
    // `oref-tryit-reset`, `oref-kbd`), and the description section with its count
    // (`oref-section-description`, `oref-section-count`), which `NodePanel` draws the way it
    // always drew the bare description. Whether the bench head becomes a position belongs to
    // the telltale adoption task, with the two page heads TX-FRAME already put there.
    // ELEVEN ARRIVED WITH THE PRE-M5 CLEANUP, 2026-08-28, and they had been on the page since
    // `T046`: the service card of SPEC 15.3 is an article the reference draws outside every
    // position, and it shipped outside this sweep, so the card's whole vocabulary, the page,
    // the kicker, the meta line with its id and live status mark, the facts section with its
    // label and value cells, and the server list, was on no list and telltale styled none of
    // it. The page looked deliberate and was not, which is the sweep's whole reason to exist.
    // EIGHTEEN ARRIVED WITH THE PRE-`T049` SLICE, 2026-08-29, and they had been on the page
    // since `TX-SHAPES` and `TX-PARITY-UI`: the shapes page is fourteen names and the states
    // page four, and both addresses had been held out of this sweep by a comment calling them a
    // theme author's pages rather than a reader's. SPEC 13.3 lists both in the reader page
    // family, so the comment was wrong and the sweep was six kinds wide over an eight kind
    // union. The list of pages is bound to `PageKind` in the same change, which is what stops
    // the next kind arriving the way these two and the service card did.
    // TWENTY ARRIVED WITH `T050`, 2026-08-29, AND SEVENTEEN OF THEM ARE CLASS NAMES THE TREE DID
    // NOT HAVE BEFORE IT. A channel is a node, so its page is the `node` kind of the record above
    // and the binding to `PageKind` could not see a whole family of markup arriving: both `node`
    // renders were OpenAPI documents, so every class the three channel sections emit would have
    // been on no list and styled by no rule, which is the service card's failure met from a
    // direction the union cannot report. The sweep answers with two more renders rather than a
    // wider record. The three that are not new are the other half of the same finding:
    // `oref-media-schema`, `oref-schema-link` and `oref-subtitle` existed before this task and had
    // never survived a sweep, because the positions that emit them are positions this theme
    // overrides. `oref-media-body` was counted with those three when this comment was first
    // written and is not one of them: it is new, and it is a modifier, which are different
    // questions. On the second question all twenty carry a rule here, and eight of them are
    // modifiers on families the reference already had, the three `oref-section` ones, the three
    // `oref-media` ones and the two directions on `oref-badge`, which are the same eight the
    // default theme records as modifiers without rules of their own.
    expect(surviving).toEqual([
      'oref-badge',
      'oref-bench-actions',
      'oref-bench-kicker',
      'oref-bench-page',
      'oref-channel-op',
      'oref-channel-ops',
      'oref-channel-reply',
      'oref-code',
      'oref-description',
      'oref-direction-receive',
      'oref-direction-send',
      'oref-endpoint',
      'oref-example',
      'oref-fact',
      'oref-fact-label',
      'oref-fact-value',
      'oref-facts',
      'oref-field',
      'oref-field-control',
      'oref-field-label',
      'oref-field-note',
      'oref-health-page',
      'oref-kbd',
      'oref-media',
      'oref-media-binding',
      'oref-media-body',
      'oref-media-example',
      'oref-media-head',
      'oref-media-schema',
      'oref-media-type',
      'oref-message',
      'oref-messages',
      'oref-method-get',
      'oref-method-post',
      'oref-operation',
      'oref-operation-header',
      'oref-path',
      'oref-root',
      'oref-run-result',
      'oref-schema-link',
      'oref-section',
      'oref-section-channel',
      'oref-section-channel-operations',
      'oref-section-count',
      'oref-section-description',
      'oref-section-health',
      'oref-section-messages',
      'oref-section-request',
      'oref-section-security',
      'oref-section-service',
      'oref-section-socket',
      'oref-section-title',
      'oref-section-tryit',
      'oref-security-item',
      'oref-security-list',
      'oref-security-type',
      'oref-security-where',
      'oref-send',
      'oref-server',
      'oref-service-fact',
      'oref-service-fact-label',
      'oref-service-fact-value',
      'oref-service-id',
      'oref-service-kicker',
      'oref-service-meta',
      'oref-service-page',
      'oref-service-servers',
      'oref-service-status',
      'oref-shape-add',
      'oref-shape-announce',
      'oref-shape-branch-note',
      'oref-shape-branch-row',
      'oref-shape-control',
      'oref-shape-d0',
      'oref-shape-d1',
      'oref-shape-empty',
      'oref-shape-field',
      'oref-shape-hint',
      'oref-shape-hint-cond',
      'oref-shape-mark',
      'oref-shape-mark-cond',
      'oref-shape-name',
      'oref-shape-pattern',
      'oref-shape-pattern-row',
      'oref-shape-req',
      'oref-shape-req-cond',
      'oref-shape-row',
      'oref-shape-rows',
      'oref-shape-type',
      'oref-shape-variant',
      'oref-shape-when',
      'oref-shapes',
      'oref-shapes-fill',
      'oref-shapes-page',
      'oref-shapes-read',
      'oref-socket-log',
      'oref-states-item',
      'oref-states-lead',
      'oref-states-list',
      'oref-states-page',
      'oref-subtitle',
      'oref-title',
      'oref-tryit-actions',
      'oref-tryit-form',
      'oref-tryit-notice',
      'oref-tryit-reset',
    ]);
  });

  it('should sweep every kind of reader page, or say in words why it does not', () => {
    // Given the record above, which is total over `PageKind` and so cannot omit a kind without
    // failing to compile. What it can still do at runtime is carry a kind with nothing under it,
    // which is what a hand list looks like from the inside, so that is what this checks.
    const swept = sweptPages();

    // When
    const empty = Object.entries(swept).filter(([, entry]) =>
      'excluded' in entry ? entry.excluded.trim() === '' : entry.length === 0,
    );

    // Then every kind is either rendered at least once or excluded with a reason a reader can
    // read. The count is asserted too, because an object that lost its entries reports the same
    // empty list as one where every entry is full.
    expect(empty.map(([kind]) => kind)).toEqual([]);
    expect(Object.keys(swept)).toHaveLength(8);

    // And the renders are more numerous than the kinds, which is the fact the previous hand
    // written list encoded by hand: `node` and `bench` are each drawn from two documents.
    expect(sweptRenderCount()).toBe(15);
  });

  it('should reconcile what the renderer can emit with what this sweep reaches, in both directions', async () => {
    // Given both sets, taken by two different instruments: one reads the sources by SPEC 10.4's
    // rule, the other renders eight kinds of page and reads the markup. Until `T062` the two were
    // compared by a person on a date, which is how the previous figures went stale between
    // milestones without anything going red.
    const emitted = emittedCoreClasses();
    const surviving = await survivingCoreClasses();

    // Then the subject is present before anything is said about absence: the renderer emits names,
    // the sweep reaches names, and the sweep reaches fewer.
    expect(emitted.files).toBe(79);
    expect(emitted.literals).toHaveLength(355);
    expect(emitted.prefixes).toHaveLength(11);
    expect(emitted.names).toHaveLength(344);
    expect(surviving.length).toBeLessThan(emitted.names.length);

    // And the partition is pinned, both ways. 245 emitted names no fixture provokes is the number
    // the `T062` amendment section carries with the reason for each family; a name arriving on
    // either side moves one of these and is read rather than absorbed.
    const emittedNotSwept = emitted.names.filter((name) => !surviving.includes(name));
    const sweptNotEmitted = surviving.filter((name) => !emitted.names.includes(name));
    expect(emittedNotSwept).toHaveLength(242);
    expect(sweptNotEmitted).toEqual([
      'oref-method-get',
      'oref-method-post',
      'oref-shape-d0',
      'oref-shape-d1',
    ]);

    // AND EACH OF THOSE FOUR IS BUILT AT RUNTIME FROM A LITERAL THE RULE DOES COUNT, which is the
    // whole reason they are swept and not emitted. Two come from `oref-method-`, a prefix the rule
    // sees; two come from `oref-shape-d`, which the rule reads as a name because it does not end
    // in a hyphen. That asymmetry is a limit of SPEC 10.4's rule rather than a defect in either
    // instrument, and it is asserted here so it is a measured fact and not a footnote.
    for (const name of sweptNotEmitted) {
      expect(emitted.literals.some((literal) => literal !== name && name.startsWith(literal))).toBe(
        true,
      );
    }
    expect(emitted.prefixes).toContain('oref-method-');
    expect(emitted.names).toContain('oref-shape-d');
  });

  it('should be a count the three documents that quote it agree with, since none of them owns it', async () => {
    // Given, this file is the one place the list lives, and three documents quote its size:
    // `THEME-BOUNDARY.md` beside the package, SPEC 10.4, and `PUBLIC-API.md`, which is where a
    // theme author meets the surface. Every one of them was stale before `T031-R1`: all three
    // said 25, which was the T032 figure, while the list here had grown to 37 across four tasks.
    //
    // THE NUMBER IS NOT REPEATED IN THIS ASSERTION EITHER. It is read off the list, so the day a
    // name arrives the case above goes red on the name and this one goes red on every document
    // that did not follow, which is the T034 rule about a figure written in three places.
    //
    // FOUR FIGURES SINCE THE POST-`T054` REVIEW, AND THE REASON IS WHAT IT FOUND. This case pinned
    // the count alone, so when `T054` moved the boundary from 86 to 99 the one sentence with a
    // runner was updated and the three without one were not: the same section still said twelve
    // renders where there were fifteen, still said 85 of the 86 were styled, and still carried an
    // arrival table summing to 86 with no row for the thirteen names that had just arrived. A
    // figure with a runner beside three without one is the defect this case exists against, met
    // one level down, so the render total, the styled total and the table's own arithmetic are
    // read off the measurement here too. All four come from the sweep rather than from prose.
    const surviving = await survivingCoreClasses();
    const count = String(surviving.length);
    const renders = String(sweptRenderCount());
    const styled = String(styledHere(surviving, themeStylesheet()).length);
    const boundary = readFileSync(join(packageRoot, 'THEME-BOUNDARY.md'), 'utf8');

    const documents: { name: string; text: string; anchor: string; quotes: readonly string[] }[] = [
      {
        name: 'THEME-BOUNDARY.md',
        text: boundary,
        anchor: 'class names the theme did not write',
        quotes: [
          `${count} class names the theme did not write`,
          `${renders} renders in all`,
          `${styled} of the ${count} are styled here`,
        ],
      },
      {
        name: 'packages/vue/PUBLIC-API.md',
        text: readFileSync(join(packageRoot, '..', 'vue', 'PUBLIC-API.md'), 'utf8'),
        anchor: 'class names the reference leaves in the markup are not frozen',
        quotes: [`${count} of them as of`],
      },
    ];

    // SPEC 10.4 IS THE THIRD DOCUMENT AND IT IS NOT IN EVERY CHECKOUT. `ai-docs/` is git excluded,
    // so CI never has it, and until the pre-M4 review this case read it unconditionally: measured
    // by moving the directory aside, the read threw `ENOENT` and took the whole run red, which is
    // `pnpm test` red on every checkout but the maintainer's. The two committed documents are
    // checked wherever this runs, and the specification is added when it is there, so a clone
    // covers two thirds rather than none and the maintainer's tree covers all three. The section
    // is written in Russian, so its anchor is quoted in the language the sentence is in.
    const specPath = join(packageRoot, '..', '..', 'ai-docs', 'SPEC.md');
    if (existsSync(specPath)) {
      documents.push({
        name: 'ai-docs/SPEC.md, section 10.4',
        text: readFileSync(specPath, 'utf8'),
        anchor: 'имён классов из пространства имён ядра',
        quotes: [`стилизует ${count} имён классов из пространства имён ядра`],
      });
    }

    expect(documents.length).toBeGreaterThanOrEqual(2);

    // When, Then. The sentence is located before the number is read out of it, so a document
    // that stopped stating the boundary at all fails here on the sentence rather than passing
    // for having nothing left to be wrong about.
    //
    // WHITESPACE IS COLLAPSED BEFORE MATCHING, because these are wrapped paragraphs and a
    // sentence that states a figure may have a line break anywhere in it. Matching the raw text
    // would make the pin depend on where the paragraph happens to wrap, which is a green case
    // turning red for a reflow and, worse, a stale figure passing because the reflow moved.
    const flat = (text: string): string => text.replace(/\s+/g, ' ');

    for (const document of documents) {
      const text = flat(document.text);
      expect(
        text,
        `${document.name} no longer carries the sentence that states this boundary`,
      ).toContain(flat(document.anchor));

      for (const quote of document.quotes) {
        expect(text, `${document.name} does not state "${quote}"`).toContain(flat(quote));
      }
    }

    // AND THE ARRIVAL TABLE ADDS UP TO THE SAME NUMBER, which is the third figure that went stale
    // and the only one that cannot be a single sentence: it is a row per task, and a task that
    // moves the boundary without adding one leaves a table that reads as complete and is not.
    // The deltas are parsed rather than counted, so an unparsable cell fails here instead of
    // being silently treated as zero.
    const table: string[] = [];
    const fromAnchor = boundary.slice(boundary.indexOf('Where the arrivals came from'));
    expect(boundary, 'THEME-BOUNDARY.md no longer carries the arrival table').toContain(
      'Where the arrivals came from',
    );

    for (const line of fromAnchor.split('\n')) {
      if (!line.startsWith('|')) {
        if (table.length > 0) break;
        continue;
      }
      table.push(line);
    }

    const deltas = table.slice(2).map((row) => (row.split('|')[2] ?? '').trim());
    const parsed = deltas.map((cell) => {
      const match = /^(plus |minus )?(\d+)$/.exec(cell);
      return match === null ? null : (match[1] === 'minus ' ? -1 : 1) * Number(match[2]);
    });

    expect(
      deltas.filter((_, index) => parsed[index] === null),
      'a row of the arrival table states its names in a form this case cannot read',
    ).toEqual([]);
    expect(
      parsed.length,
      'the arrival table was read as empty, so its arithmetic proves nothing',
    ).toBeGreaterThan(1);
    expect(
      parsed.reduce((total, delta) => (total ?? 0) + (delta ?? 0), 0),
      'the arrival table does not add up to the boundary it explains',
    ).toBe(surviving.length);
  });

  it('should force this theme to style class names it did not author', async () => {
    // Given the stylesheet this theme ships, and the class names the reference leaves on the page.
    const css = themeStylesheet();
    const surviving = await survivingCoreClasses();

    // ONE is deliberately not styled, and saying which is the point: `oref-section-health` is
    // the element this theme does not reach inside, because the health position is its own. The
    // comment here named two until `T031-R1` read it against the assertion below: `oref-root`
    // has a rule in this stylesheet, `display: contents`, so it is styled and always was.
    const styled = styledHere(surviving, css);

    // When
    const unstyled = surviving.filter((name) => !styled.includes(name));

    // Then every one of them is either styled here or named as deliberately not. A class that
    // arrived and was styled by nobody is an unstyled region on a page a reader opens, and it
    // would look exactly like a theme that had not been finished.
    expect(unstyled).toEqual(['oref-section-health']);
    expect(styled.length).toBeGreaterThan(20);
  });

  it('should include two whole blocks of content that have no position at all', async () => {
    // Given, the security requirements of an operation and its request body are drawn entirely by
    // the reference. Not the frame around a position: the content.
    const html = (
      await renderPage(apiDocument(), { nodeId: postNodeId(), markdown, theme: telltale })
    ).appHtml;

    // When, Then the scheme id, its type and the heading over it are all the reference's markup on
    // a page where every registry position is this theme's
    expect(html).toContain('<h2 class="oref-section-title">Security</h2>');
    expect(html).toContain('<span class="oref-security-type">apiKey</span>');
    expect(html).toContain('<h2 class="oref-section-title">Request body</h2>');
  });

  it('should receive the runtime block ahead of the specification, which is this theme thesis', async () => {
    // Given, telltale's handoff says in its first line what it does that the other two directions
    // do not: the runtime block comes before the specification rather than after it. That order is
    // decided inside `NodePanel`, which is not a slot, and the shell is handed the page as opaque
    // children, so no position of the contract can express it. Until TX-GUTTER this theme undid
    // the reference's column order in CSS with `column-reverse`; the parity scale put the runtime
    // block directly after the header, so the document order now IS this theme's order, and the
    // reading order a screen reader follows finally matches what the CSS used to fake.
    const html = (
      await renderPage(runtimeDocument(), { nodeId: nodeId(), markdown, theme: telltale })
    ).appHtml;

    // When, the runtime position resolves to this theme's own block
    const runtime = html.indexOf('tt-runtime');
    const description = html.indexOf('oref-description');

    // Then the runtime block precedes the prose in the document itself
    expect(runtime).toBeGreaterThan(-1);
    expect(description).toBeGreaterThan(runtime);
  });

  it('should require the health position to write a class from the reference namespace', async () => {
    // Given, the browser fills the health position with `h('section', { class:
    // 'oref-section-health' })` and nothing else, so hydration compares the class list against
    // exactly that one name.
    // The panel lives on the health page since TX-FRAME, per SPEC 7.3.
    const html = (
      await renderPage(runtimeDocument(), { page: 'health', markdown, theme: telltale })
    ).appHtml;

    // When, Then this theme's override writes that class, alone, and puts its own class inside.
    // A root carrying both would have this theme's class patched away on hydration, silently, in a
    // browser and nowhere else.
    expect(html).toContain('<section class="oref-section-health"><div class="tt-health">');
  });

  it('should build every link by transcribing a route table it cannot import', () => {
    // Given, `NavTree` is handed `nodeId`, `schemaId` and `basePath` and has to build the href;
    // `CommandPalette` is handed hits that already carry one. So one position of the contract gets
    // the answer and the other gets the parts, and assembling the parts means knowing the
    // reference's route table, which lives in `@openref/render` and is not published.
    const base = '/docs';

    // When, Then this theme's three rules agree with the three the reference serves. This case is
    // the only thing that makes a wrong transcription fail: a wrong href is a string, and every
    // other test in this package would pass with all of them broken.
    expect(overviewHref('')).toBe(referenceOverviewHref(''));
    expect(overviewHref(base)).toBe(referenceOverviewHref(base));
    expect(nodeHref('get-orders', base)).toBe(referenceNodeHref('get-orders', base));
    expect(nodeHref('get /a b', base)).toBe(referenceNodeHref('get /a b', base));
    expect(schemaHref('Order', base)).toBe(referenceSchemaHref('Order', base));
    expect(schemaHref('Order__1a2b3c4d', base)).toBe(referenceSchemaHref('Order__1a2b3c4d', base));

    // THE REFERENCE HAS THREE RULES AND THIS CASE COMPARED ONE OF THEM UNTIL `T031-R1`. T039
    // added the character escape; T043 added two whole name rules beside it, and the
    // transcription never got either, so this theme's link to a schema called `CON` or `Order.`
    // pointed at an address the server does not serve, for a fortnight, green the whole time.
    // The rule is asserted live in the reference first, because a table of ids proves nothing
    // about a rule that has stopped firing: both sides would agree on the identity.
    expect(referenceNodeHref('CON', base), 'the device name rule is not firing').toContain(
      '_u0043_',
    );
    expect(referenceNodeHref('Order.', base), 'the trailing tail rule is not firing').toContain(
      '_u002e_',
    );
    // AND THE FOURTH RULE, ADDED AT `T065`: a node segment equal to a name the mount claims for a
    // route of its own is escaped, or the node's page is unreachable behind that route. Asserted
    // live in the reference first, for the reason the three below it are: a table of ids proves
    // nothing about a rule that has stopped firing, because both sides would agree on the identity.
    expect(
      referenceNodeHref('_search-index', base),
      'the reserved mount name rule is not firing',
    ).toContain('_u005f_');

    expect(referenceNodeHref('Order\u202eDto', base), 'the character rule is not firing').toContain(
      '_u202e_',
    );

    // And then all three agree, class by class and name by name, because an approximate
    // transcription 404s only on the ids it differs on: a directional control from each escaped
    // range, the literal `_uXXXX_` lookalike the guard exists for, the two segments that are path
    // grammar rather than names, every device family Windows reserves with and without an
    // extension, and both characters Win32 strips off the end of a name. Controls are written as
    // escapes so this source file carries no invisible character.
    for (const id of [
      'Order\u202eDto',
      '\u061cOrder',
      'Order\u200f',
      'Order\u2066Dto\u2069',
      'Order_u202e_Dto',
      '_u005f_',
      '.',
      '..',
      'Fine.Name',
      'CON',
      'con',
      'NUL',
      'NUL.json',
      'aux',
      'prn',
      'com1',
      'com\u00b9',
      'lpt3',
      'conin$',
      'conout$',
      'con.',
      'Order.',
      'Order ',
      'Console',
    ]) {
      expect(nodeHref(id, base), `nodeHref disagrees on ${JSON.stringify(id)}`).toBe(
        referenceNodeHref(id, base),
      );
      expect(schemaHref(id, base), `schemaHref disagrees on ${JSON.stringify(id)}`).toBe(
        referenceSchemaHref(id, base),
      );
    }

    // THE RESERVED NAMES ARE WALKED FROM THE REFERENCE'S OWN LIST AND NOT FROM A LIST WRITTEN HERE,
    // which is what makes this a reconciliation rather than a third transcription. A name added to
    // `links.ts` in `@openref/render` extends this loop by itself, and the theme fails it until the
    // same name is added there too. The list equality below closes the other direction, where the
    // theme escapes a name the reference does not.
    expect([...THEME_RESERVED].sort()).toEqual([...REFERENCE_RESERVED].sort());
    expect(REFERENCE_RESERVED.length).toBeGreaterThan(0);

    for (const id of REFERENCE_RESERVED) {
      expect(nodeHref(id, base), `nodeHref disagrees on the reserved name ${id}`).toBe(
        referenceNodeHref(id, base),
      );
    }

    expect(entryHref({ nodeId: 'get-orders', schemaId: null }, base)).toBe(
      referenceNodeHref('get-orders', base),
    );
    expect(entryHref({ nodeId: null, schemaId: 'Order' }, base)).toBe(
      referenceSchemaHref('Order', base),
    );
    expect(entryHref({ nodeId: null, schemaId: null }, base)).toBeNull();
  });

  it('should install the one package SPEC 4 promises a theme author, since `T031-R1`', () => {
    // Given, SPEC 4 says a theme author installs `@openref/vue`. Four of the props the frozen
    // registry declares are types of `@openref/core`, and that package re-exported none of them,
    // so a theme that types the value it is handed reached for a second package. Found on T032
    // as three names; the fourth, `UnsendableCause` on `RunnerSecuritySchemeView`, arrived with
    // the runner and was never counted. `T031-R1` re-exported all four and this case turned over.
    //
    // READ OFF `PUBLIC-API.md` AND NOT OFF THE MODULE. A type has no runtime identity, so
    // `Object.keys` of the imported namespace can never contain one of these names and a case
    // written that way would be green for the wrong reason. That document is the published
    // surface, checked in both directions against `dist/*.d.ts` by T031's own suite, so a name
    // documented there and missing from the artefact fails over there rather than here.
    const surface = readFileSync(join(packageRoot, '..', 'vue', 'PUBLIC-API.md'), 'utf8');

    // When, Then. The row is read as CELLS rather than as a literal, because `IRSchema` is a
    // prefix of `IRSchemaView` and a substring match would report one name twice, while a literal
    // `| \`x\` | type |` also asserted the table's column widths: `T065` put every markdown file
    // under `packages/` on the format list, prettier aligns a table to its widest cell, and this
    // case then failed on a document whose contents had not changed. What it is about is which
    // names the register publishes and as what, so that is what it reads.
    const published = new Map(
      [...surface.matchAll(/^\|([^|\n]*)\|([^|\n]*)\|/gm)].map((row) => [
        (row[1] ?? '').trim().replaceAll('`', ''),
        (row[2] ?? '').trim(),
      ]),
    );

    expect(
      published.size,
      'PUBLIC-API.md carries no table rows, so this case proves nothing',
    ).toBeGreaterThan(20);
    expect(published.has('SlotName')).toBe(true);
    for (const name of ['IRConfidence', 'IRSchema', 'IRSchemaView', 'UnsendableCause']) {
      expect(published.get(name), `PUBLIC-API.md does not publish ${name} as a type`).toBe('type');
    }

    // And no file of this theme's source reaches for the core package any more. Walked from
    // disk rather than listed, because a list of files is accurate exactly as long as the hand
    // that wrote it, and the file that would break this rule is the one added later.
    const naming: string[] = [];
    let scanned = 0;

    const visit = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
          visit(path);
          continue;
        }
        if (!entry.name.endsWith('.ts')) continue;

        scanned += 1;
        if (readFileSync(path, 'utf8').includes("from '@openref/core'")) naming.push(path);
      }
    };

    visit(join(packageRoot, 'src'));

    expect(naming).toEqual([]);
    expect(scanned, 'the sweep read no source files, so it proves nothing').toBeGreaterThan(20);

    // And the manifest says the same thing to whoever installs the package, which is the half a
    // source sweep cannot see: a peer dependency is what an installer is told to bring.
    const manifest: unknown = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
    const peers = (manifest as { peerDependencies?: Record<string, string> }).peerDependencies;

    expect(Object.keys(peers ?? {}).sort()).toEqual(['@openref/vue', 'vue']);
  });

  it('should transcribe the structural DOM shim, and have that transcription checked', () => {
    // Given, T011 scopes DOM types to `src/browser` and the integration suite, so a component
    // that renders on both sides cannot name one. `packages/render/src/shared/dom.ts` is what
    // makes that possible, `@openref/render` is private, and every theme writes the file again;
    // `src/dom.ts` is this one's. Until `T031-R1` NOTHING CHECKED IT, and its own comment
    // pointed at a section of `THEME-BOUNDARY.md` that did not exist.
    //
    // The route table next door had a case and still drifted, because that case compared one of
    // three rules. So this one compares behaviour over a table and shape at compile time, and
    // pins which names the two files share, which is the thing that silently changes.
    const shimSource = (path: readonly string[]): string =>
      readFileSync(join(packageRoot, ...path), 'utf8');

    const exportsOf = (source: string): string[] =>
      [...source.matchAll(/^export (?:interface|function|type|const) (\w+)/gm)]
        .map((match) => match[1] ?? '')
        .sort();

    const theme = exportsOf(shimSource(['src', 'dom.ts']));
    const reference = exportsOf(shimSource(['..', 'render', 'src', 'shared', 'dom.ts']));

    // When
    const shared = theme.filter((name) => reference.includes(name));

    // Then the two files declare eleven shapes each and share five of them, which is also why
    // publishing the reference's shim would close less than half of this: the other six are what
    // this theme's own components touch and the reference's do not.
    expect(
      theme.length,
      'the theme shim declares nothing, so this case proves nothing',
    ).toBeGreaterThan(0);
    expect(reference.length, 'the reference shim declares nothing').toBeGreaterThan(0);
    expect(theme, 'the theme shim no longer declares 11 shapes').toHaveLength(11);
    expect(reference, 'the reference shim no longer declares 11 shapes').toHaveLength(11);
    expect(shared).toEqual(['FileEvent', 'PickedFile', 'ValueEvent', 'eventFile', 'eventValue']);

    // And the two shared functions answer identically, including where the browser hands them
    // something they cannot use. A transcription that diverged here would swallow a reader's
    // input in one theme and not the other, with nothing to see in either.
    const file: ThemePickedFile & ReferencePickedFile = {
      name: 'order.json',
      type: 'application/json',
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    };

    const valueEvents: (ThemeValueEvent & ReferenceValueEvent)[] = [
      { target: { value: 'typed' } },
      { target: { value: '' } },
      { target: { value: 42 } },
      { target: {} },
      { target: null },
      {},
    ];

    for (const event of valueEvents) {
      expect(themeEventValue(event)).toBe(referenceEventValue(event));
    }

    const fileEvents: (ThemeFileEvent & ReferenceFileEvent)[] = [
      { target: { files: [file] } },
      { target: { files: [] } },
      { target: { files: null } },
      { target: null },
      {},
    ];

    for (const event of fileEvents) {
      expect(themeEventFile(event)).toBe(referenceEventFile(event));
    }

    // And the shapes themselves agree in both directions, which `tsc` decides and not vitest.
    // `Mutual` resolves to `false` the moment one declaration stops describing the other, and
    // `false` is not assignable to the tuple below, so a drift fails `pnpm lint` before this
    // file is ever run. The runtime assertion is what keeps the pin from being dead code.
    const shapesAgree: [
      Mutual<ThemeValueEvent, ReferenceValueEvent>,
      Mutual<ThemeFileEvent, ReferenceFileEvent>,
      Mutual<ThemePickedFile, ReferencePickedFile>,
    ] = [true, true, true];

    expect(shapesAgree).toEqual([true, true, true]);
    expect(themeEventValue({ target: { value: 'typed' } })).toBe('typed');
    expect(themeEventFile({ target: { files: [file] } })).toBe(file);
  });
});

describe('the acceptance test of T032, which is an empty diff to every other package', () => {
  it('should be named by nothing in any other package source', () => {
    // Given, the task's definition of done is that the core did not grow to accommodate this
    // theme. A diff is a fact about one session and cannot be committed; what can be committed is
    // the invariant the diff was protecting: no other package knows this one exists.
    //
    // IT WALKS `packages/` FROM DISK rather than listing the packages it checks, because a list
    // written by hand is accurate exactly as long as the hand, and a package added later would be
    // outside the sweep with nothing red.
    const root = join(import.meta.dirname, '..', '..', '..');
    const others = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== 'theme-telltale')
      .map((entry) => join(root, entry.name, 'src'));

    // When
    const naming: string[] = [];
    let scanned = 0;

    const visit = (directory: string): void => {
      let entries;
      try {
        entries = readdirSync(directory, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
          visit(path);
          continue;
        }
        if (!entry.name.endsWith('.ts')) continue;

        scanned += 1;
        if (readFileSync(path, 'utf8').includes('theme-telltale')) naming.push(path);
      }
    };

    for (const directory of others) visit(directory);

    // Then. The count is asserted as well, because a sweep that found no files reports the same
    // empty list as a repository where nothing names this package.
    expect(naming).toEqual([]);
    expect(others.length).toBeGreaterThanOrEqual(11);
    expect(scanned, 'the sweep read no source files, so it proves nothing').toBeGreaterThan(200);
  });
});
