import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import telltale from '../../src/theme';
import { entryHref, nodeHref, overviewHref, schemaHref } from '../../src/links';
import {
  eventFile as themeEventFile,
  eventValue as themeEventValue,
  type FileEvent as ThemeFileEvent,
  type PickedFile as ThemePickedFile,
  type ValueEvent as ThemeValueEvent,
} from '../../src/dom';
import { apiDocument, nodeId, postNodeId, runtimeDocument } from '../mocks/documents';
import { createMarkdownRenderer } from '../../../render/src/markdown/domain/markdown';
import {
  nodeHref as referenceNodeHref,
  overviewHref as referenceOverviewHref,
  schemaHref as referenceSchemaHref,
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

/** Class names from the reference's own namespace that survive a complete L2 theme. */
async function survivingCoreClasses(): Promise<readonly string[]> {
  const found = new Set<string>();
  const document = apiDocument();

  // The health page is rendered from the document with an application behind it, because the
  // panel is drawn only when there is a report, and a sweep that missed it would report a
  // smaller boundary than the one that exists. Seven renders over the five kinds of page a
  // reader can open: the bench carries the console the node page lost, and health carries the
  // panel the overview lost, and node and bench are each rendered twice because the two mock
  // documents put different sections on them. The two showcase addresses stay out: they are a
  // theme author's pages, not a reader's. The count is corrected here by `T031-R1`; it read
  // "six pages" while this list held seven entries.
  const pages = [
    { document: runtimeDocument(), where: { nodeId: nodeId() } },
    { document, where: { nodeId: postNodeId() } },
    { document: runtimeDocument(), where: {} },
    { document, where: { schemaId: 'Order' } },
    { document, where: { page: 'bench' as const, nodeId: postNodeId() } },
    { document: runtimeDocument(), where: { page: 'bench' as const, nodeId: nodeId() } },
    { document: runtimeDocument(), where: { page: 'health' as const } },
  ];

  for (const page of pages) {
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

  return [...found].sort();
}

describe('the markup a complete L2 theme does not own', () => {
  it('should be exactly these class names, on the five kinds of page a reader can open', async () => {
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
    expect(surviving).toEqual([
      'oref-badge',
      'oref-bench-actions',
      'oref-bench-kicker',
      'oref-bench-page',
      'oref-code',
      'oref-description',
      'oref-endpoint',
      'oref-example',
      'oref-field',
      'oref-field-control',
      'oref-field-label',
      'oref-field-note',
      'oref-health-page',
      'oref-kbd',
      'oref-media',
      'oref-media-head',
      'oref-media-type',
      'oref-method-get',
      'oref-method-post',
      'oref-operation',
      'oref-operation-header',
      'oref-path',
      'oref-root',
      'oref-section',
      'oref-section-count',
      'oref-section-description',
      'oref-section-health',
      'oref-section-request',
      'oref-section-security',
      'oref-section-title',
      'oref-section-tryit',
      'oref-security-item',
      'oref-security-list',
      'oref-security-type',
      'oref-title',
      'oref-tryit-form',
      'oref-tryit-reset',
    ]);
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
    const surviving = await survivingCoreClasses();
    const count = String(surviving.length);

    const documents: { name: string; text: string; anchor: string; quote: string }[] = [
      {
        name: 'THEME-BOUNDARY.md',
        text: readFileSync(join(packageRoot, 'THEME-BOUNDARY.md'), 'utf8'),
        anchor: 'class names the theme did not write',
        quote: `${count} class names the theme did not write`,
      },
      {
        name: 'packages/vue/PUBLIC-API.md',
        text: readFileSync(join(packageRoot, '..', 'vue', 'PUBLIC-API.md'), 'utf8'),
        anchor: 'class names the reference leaves in the markup are not frozen',
        quote: `${count} of them as of`,
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
        quote: `стилизует ${count} имён классов из пространства имён ядра`,
      });
    }

    expect(documents.length).toBeGreaterThanOrEqual(2);

    // When, Then. The sentence is located before the number is read out of it, so a document
    // that stopped stating the boundary at all fails here on the sentence rather than passing
    // for having nothing left to be wrong about.
    for (const document of documents) {
      expect(
        document.text,
        `${document.name} no longer carries the sentence that states this boundary`,
      ).toContain(document.anchor);
      expect(document.text, `${document.name} does not state the count as ${count}`).toContain(
        document.quote,
      );
    }
  });

  it('should force this theme to style class names it did not author', async () => {
    // Given the stylesheet this theme ships, and the class names the reference leaves on the page.
    const css = readFileSync(
      join(import.meta.dirname, '..', '..', 'src', 'styles', 'theme.css'),
      'utf8',
    );
    const surviving = await survivingCoreClasses();

    // ONE is deliberately not styled, and saying which is the point: `oref-section-health` is
    // the element this theme does not reach inside, because the health position is its own. The
    // comment here named two until `T031-R1` read it against the assertion below: `oref-root`
    // has a rule in this stylesheet, `display: contents`, so it is styled and always was.
    const styled = surviving.filter((name) => css.includes(`.${name}`));

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

    // When, Then. The row form is asserted rather than the bare name, because `IRSchema` is a
    // prefix of `IRSchemaView` and a substring match would report one name twice.
    expect(surface, 'PUBLIC-API.md is empty, so this case proves nothing').toContain('SlotName');
    for (const name of ['IRConfidence', 'IRSchema', 'IRSchemaView', 'UnsendableCause']) {
      expect(surface, `PUBLIC-API.md does not publish ${name}`).toContain(`| \`${name}\` | type |`);
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
