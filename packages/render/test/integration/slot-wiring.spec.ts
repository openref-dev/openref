import { normalizeOpenApiDocument, type IRDocument, type IROperation } from '@openref/core';
import { defineTheme, SLOT_NAMES, type PageKind, type SlotName } from '@openref/vue';
import { describe, expect, it } from 'vitest';
import { h, type Component, type VNode } from 'vue';
import { createMarkdownRenderer } from '../../src/markdown/domain/markdown';
import { renderPage } from '../../src/render/application/services/render.service';
import { eventsDocument, runtimeDocument, runtimeNodeId, smallDocument } from '../mocks/documents';

/**
 * Every slot of the frozen registry, driven through the renderer a reader loads.
 *
 * THIS FILE IS WHAT THE FREEZE RESTS ON, and the rule it exists for is one sentence: a slot is
 * not in the frozen registry until a case drives it through the real renderer and asserts that a
 * theme override changes the page. Twenty-one names were undeliverable before `TX-SLOTWIRE` and
 * nothing said so, because every proof of the slot mechanism handed the props in: `useSlot` was
 * called by `@openref/vue` and by its own tests and by nothing else, `renderThemeSlots` takes the
 * props from its caller, and `slot-override.spec.ts` proves the mechanism on a tree built for it.
 * A count is not evidence. A case per name is.
 *
 * IT GOES THROUGH `renderPage`, which is the pipeline of SPEC 12: the page model, the eager
 * deferrable registry, the server render, the cache key. Nothing here builds a component tree of
 * its own, so a position that stopped being resolved would fail here even if every unit test on
 * the component kept passing.
 *
 * WHAT EACH CASE ASSERTS IS BOTH DIRECTIONS. The override's own markup is on the page, and the
 * markup the reference draws in that position is gone. Only the first would pass a renderer that
 * drew the override somewhere harmless and kept its own; only the second would pass one that drew
 * nothing at all.
 */

const markdown = await createMarkdownRenderer();

/** What a theme's component writes, so a case can look for one string. */
function probe(slot: SlotName): Component {
  return () => h('div', { class: `probe-${slot}` }, `theme drew ${slot}`);
}

/** Renders one page of one document with one slot replaced. */
async function pageWith(
  document: IRDocument,
  slot: SlotName,
  where: {
    readonly page?: PageKind;
    readonly nodeId?: string | null;
    readonly schemaId?: string | null;
  } = {},
): Promise<string> {
  const rendered = await renderPage(document, {
    ...where,
    markdown,
    theme: defineTheme({ name: 'probe', components: { [slot]: probe(slot) } }),
  });

  return rendered.appHtml;
}

/** The same page with no theme at all, which is what the override has to differ from. */
async function pageWithout(
  document: IRDocument,
  where: {
    readonly page?: PageKind;
    readonly nodeId?: string | null;
    readonly schemaId?: string | null;
  } = {},
): Promise<string> {
  return (await renderPage(document, { ...where, markdown })).appHtml;
}

/**
 * Drives one slot through the renderer and checks the assertion is not vacuous.
 *
 * A PROOF OF ABSENCE PASSES BECAUSE THE SUBJECT WAS ABSENT, which is a defect class this
 * repository has hit more than once, so the reference's own marker is asserted to be on the page
 * that has no theme before it is asserted to be gone from the page that has one. A case whose
 * marker never appears at all would otherwise read as an override that worked.
 *
 * @param document - The document to render
 * @param slot - The slot to replace
 * @param marker - Something the component this package ships writes at that position
 * @param where - Which page draws the position
 * @returns The page the theme drew, for a case that wants to say more about it
 */
async function drive(
  document: IRDocument,
  slot: SlotName,
  marker: string,
  where: {
    readonly page?: PageKind;
    readonly nodeId?: string | null;
    readonly schemaId?: string | null;
  } = {},
): Promise<string> {
  const plain = await pageWithout(document, where);
  expect(
    plain,
    `the reference draws no ${marker} on this page, so the case proves nothing`,
  ).toContain(marker);

  const themed = await pageWith(document, slot, where);

  expect(themed).toContain(`theme drew ${slot}`);
  expect(themed).not.toContain(marker);

  return themed;
}

/** A document whose operation carries the call samples of SPEC 18, level 3. */
function sampleDocument(): IRDocument {
  return normalizeOpenApiDocument({
    openapi: '3.1.0',
    info: { title: 'Orders API', version: '1.0.0' },
    servers: [{ url: 'https://api.example.com' }],
    paths: {
      '/orders': {
        get: {
          operationId: 'listOrders',
          summary: 'List orders',
          responses: { '200': { description: 'ok' } },
          'x-codeSamples': [
            { lang: 'bash', label: 'cURL', source: 'curl https://api.example.com/orders' },
            { lang: 'python', source: 'httpx.get("https://api.example.com/orders")' },
          ],
        },
      },
    },
  });
}

/** A document whose operation streams, which is the only page that draws a stream log. */
function streamingDocument(): IRDocument {
  const document = smallDocument();
  const nodeId = runtimeNodeId(document);
  const node = document.nodes.get(nodeId);
  if (node?.kind !== 'operation') throw new Error('the fixture lost its node');

  const withStream: IROperation = {
    ...node,
    runtime: {
      streaming: {
        value: { transport: 'sse' },
        confidence: 'declared',
        collector: 'streamCollector',
      },
    },
  };

  const nodes = new Map(document.nodes);
  nodes.set(nodeId, withStream);

  return { ...document, nodes };
}

const NODE = runtimeNodeId();

describe('every slot of the registry, on the page a reader opens', () => {
  it('should draw the theme frame instead of the reference frame', async () => {
    // Given, `AppShell` is also what `defineTheme.layout` resolves into, so this case is the
    // proof for both mechanisms: there is one position and it is this one.
    const document = smallDocument();

    // When
    const html = await drive(document, 'AppShell', 'oref-sidebar');

    // Then, the theme's frame is there and the reference's header is gone with the rail
    expect(html).not.toContain('oref-brand');
  });

  it('should draw the theme navigation instead of the windowed tree', async () => {
    // Given
    const document = smallDocument();

    // When, Then
    await drive(document, 'NavTree', 'oref-nav-scroll');
  });

  it('should draw the theme palette instead of the search button', async () => {
    // Given, the palette renders closed on the server, which is a button and not an absence, so
    // the position is resolved on every page rather than only on an open one.
    const document = smallDocument();

    // When, Then
    await drive(document, 'CommandPalette', 'oref-palette-open');
  });

  it('should draw the theme overview instead of the document article', async () => {
    // Given
    const document = smallDocument();

    // When, Then
    await drive(document, 'DocumentOverview', 'oref-overview');
  });

  it('should draw the theme schema page instead of the reference one', async () => {
    // Given
    const document = smallDocument();

    // When, Then
    await drive(document, 'SchemaPage', 'oref-schema-page', { schemaId: 'Order' });
  });

  it('should draw the theme header instead of the operation header', async () => {
    // Given
    const document = smallDocument();

    // When, Then
    await drive(document, 'OperationHeader', 'oref-operation-title', { nodeId: NODE });
  });

  it('should draw the theme runtime block instead of the parity scale', async () => {
    // Given, the block is drawn only for a node with facts, per SPEC 6.3, so the document is the
    // one with an application behind it. Since TX-GUTTER an operation's default is the parity
    // scale, so the scale is what the override must displace.
    const document = runtimeDocument();

    // When, Then
    await drive(document, 'RuntimePanel', 'oref-parity-grid', { nodeId: NODE });
  });

  it('should draw the theme provenance mark instead of the three letter code', async () => {
    // Given
    const document = runtimeDocument();

    // When, Then
    await drive(document, 'ProvenanceTag', 'oref-prov-derived', { nodeId: NODE });
  });

  it('should draw the theme finding instead of the drift row', async () => {
    // Given
    const document = runtimeDocument();

    // When, Then
    await drive(document, 'DriftCard', 'oref-drift-rule', { nodeId: NODE });
  });

  it('should draw the theme parameter block instead of the table', async () => {
    // Given
    const document = smallDocument();

    // When, Then
    await drive(document, 'ParamTable', 'oref-param-row', { nodeId: NODE });
  });

  it('should draw the theme response list instead of the status rows', async () => {
    // Given
    const document = smallDocument();

    // When, Then
    await drive(document, 'ResponseList', 'oref-response-head', { nodeId: NODE });
  });

  it('should draw the theme call samples instead of the tab strip', async () => {
    // Given, the position exists because `x-codeSamples` is now read, per SPEC 18. A name in the
    // registry that no shipped path resolves is what this whole task removed.
    const document = sampleDocument();
    const nodeId = runtimeNodeId(document);
    expect(await pageWithout(document, { nodeId })).toContain('cURL');

    // When, Then
    await drive(document, 'CodeSample', 'oref-sample-tab', { nodeId });
  });

  it('should draw the theme schema tree instead of the expandable rows', async () => {
    // Given, the tree is driven where one still draws on a node page: the request body,
    // because the response rows became the compact index with TX-PARITY-UI.
    const document = smallDocument();
    const nodeId = [...document.nodes.keys()].find((id) => id.startsWith('post')) ?? '';

    // When, Then
    await drive(document, 'SchemaTree', 'oref-schema-tree', { nodeId });
  });

  it('should draw the theme body editor instead of the declared fields', async () => {
    // Given, the editor is drawn for an operation that declares a body, which is the POST.
    const document = smallDocument();
    const nodeId = [...document.nodes.keys()].find((id) => id.startsWith('post')) ?? '';

    // When, Then
    await drive(document, 'ShapeForm', 'oref-field-body', { page: 'bench', nodeId });
  });

  it('should draw the theme credentials block instead of the scheme fields', async () => {
    // Given
    const document = smallDocument();
    const nodeId = [...document.nodes.keys()].find((id) => id.startsWith('post')) ?? '';

    // When, Then
    await drive(document, 'AuthPanel', 'oref-field-auth-apiKey', { page: 'bench', nodeId });
  });

  it('should draw the theme server chooser instead of the url field', async () => {
    // Given
    const document = smallDocument();

    // When, Then
    await drive(document, 'ServerSelect', 'oref-field-server-url', { page: 'bench', nodeId: NODE });
  });

  it('should draw the theme send control instead of the button and its notice', async () => {
    // Given
    const document = smallDocument();

    // When, Then
    await drive(document, 'SendButton', 'The console loads when you press Send.', {
      page: 'bench',
      nodeId: NODE,
    });
  });

  it('should resolve the response position even before anything has been sent', async () => {
    // Given, the reference draws nothing there until a response arrives, which is why this case
    // asserts the position is resolved rather than that markup was replaced: a position resolved
    // only once it has content is a position a theme cannot fill with an empty state.
    const document = smallDocument();

    // When
    const html = await pageWith(document, 'ResponseView', { page: 'bench', nodeId: NODE });

    // Then
    expect(html).toContain('theme drew ResponseView');
  });

  it('should draw the theme stream log instead of the two controls', async () => {
    // Given, the log is drawn for an operation a collector said streams, per SPEC 14.6.
    const document = streamingDocument();

    // When, Then
    await drive(document, 'StreamLog', 'oref-stream-start', { page: 'bench', nodeId: NODE });
  });

  it('should draw the theme health panel, on the server, where the browser adopts it', async () => {
    // Given, this is the one server side slot: the browser fills the position with an element
    // that adopts the markup rather than drawing it, per SPEC 7.2 and 12.
    const document = runtimeDocument();

    // When, Then
    await drive(document, 'HealthScore', 'oref-health-score', { page: 'health' });
  });

  it('should draw the theme notice instead of the sentence about a missing schema', async () => {
    // Given, a stale link to a schema the document no longer declares, which is one of the eight
    // notices the renderer draws and the reason the kinds were restated from what exists.
    const document = smallDocument();
    expect(await pageWithout(document, { schemaId: 'Gone' })).toContain(
      'This document declares no such schema.',
    );

    // When, Then
    await drive(document, 'StateNotice', 'oref-schema-empty', { schemaId: 'Gone' });
  });

  it('should render a whole page from an L2 theme that fills every slot', async () => {
    // Given a theme of the shape `scaffoldTheme` writes at L2: one stub per slot, each printing
    // its own name, so an author's first run is a page that says what every region is. The
    // components are built here rather than compiled from the generated files, and the case below
    // is what keeps the two in step: the scaffold's file list and this list are both the registry.
    const components = Object.fromEntries(
      SLOT_NAMES.filter((slot) => slot !== 'AppShell').map((slot) => [slot, probe(slot)]),
    ) as Record<string, Component>;
    const theme = defineTheme({
      name: 'scaffolded',
      // The shell is the one position a scaffolded theme writes as `layout`, and it renders its
      // three regions, or the author's first run is a page with nothing in it.
      layout: () =>
        Promise.resolve(
          (
            _props: unknown,
            context: { slots: Record<string, undefined | (() => VNode[])> },
          ): VNode[] => [
            h('div', { class: 'probe-AppShell' }, 'theme drew AppShell'),
            ...(context.slots.nav?.() ?? []),
            ...(context.slots.palette?.() ?? []),
            ...(context.slots.default?.() ?? []),
          ],
        ),
      components,
    });

    // When, the reference draws a node page with nothing of its own left in it
    const rendered = await renderPage(runtimeDocument(), { nodeId: NODE, markdown, theme });

    // Then every position a node page draws is the theme's, and the frame is too
    for (const slot of ['AppShell', 'NavTree', 'CommandPalette', 'OperationHeader']) {
      expect(rendered.appHtml).toContain(`theme drew ${slot}`);
    }
    expect(rendered.appHtml).not.toContain('oref-sidebar');
    expect(rendered.appHtml).not.toContain('oref-operation-title');
  });

  /**
   * The measurement the `T050` amendment reports, given a runner.
   *
   * THE AMENDMENT'S HEADLINE FIGURE WAS PROSE. "A channel page resolves four of the 21 slots
   * against an operation page's six" was written from a run nothing repeated, so a change to the
   * page composition that stopped resolving `OperationHeader` on a channel, or started resolving
   * `ParamTable` there, would leave the sentence saying what it says. This is that run, kept.
   *
   * IT MEASURES BOTH PAGES IN ONE CASE and that is the point of it. A channel page's four are only
   * meaningful beside a number from the same probe on the same day: the operation page is the
   * control, and it is what tells "a channel resolves four" apart from "this theme resolved four
   * of everything". `AppShell` arrives through `layout`, which is where a theme writes it, so the
   * probe is one stub per remaining name plus a layout that renders its three regions.
   */
  it('should resolve four positions on a channel page against an operation page seven', async () => {
    // Given a theme that fills every position there is, so what the page does not resolve is the
    // page's own doing rather than the theme's
    const components = Object.fromEntries(
      SLOT_NAMES.filter((slot) => slot !== 'AppShell').map((slot) => [slot, probe(slot)]),
    ) as Record<string, Component>;
    const theme = defineTheme({
      name: 'census',
      layout: () =>
        Promise.resolve(
          (
            _props: unknown,
            context: { slots: Record<string, undefined | (() => VNode[])> },
          ): VNode[] => [
            h('div', { class: 'probe-AppShell' }, 'theme drew AppShell'),
            ...(context.slots.nav?.() ?? []),
            ...(context.slots.palette?.() ?? []),
            ...(context.slots.default?.() ?? []),
          ],
        ),
      components,
    });

    const census = async (document: IRDocument, nodeId: string): Promise<readonly SlotName[]> => {
      const rendered = await renderPage(document, { nodeId, markdown, theme });

      return SLOT_NAMES.filter((slot) => rendered.appHtml.includes(`theme drew ${slot}`));
    };

    // When both pages are rendered through it
    const channel = await census(eventsDocument(), 'channel-orders-tenant-requests');
    const operation = await census(smallDocument(), 'get-orders');

    // Then the channel resolves exactly the four the amendment names, and no more: the frame's
    // three, plus the head, which is keyed by `nodeId` and not by an operation view
    expect(channel).toEqual(['AppShell', 'NavTree', 'CommandPalette', 'OperationHeader']);

    // And the control is the operation page, which resolves those four and three more. Without
    // it the four above would also be what a probe that resolved nothing anywhere reports.
    //
    // `StateNotice` IS THE THIRD, AND IT IS THE SAME AMENDMENT SEEN FROM THE SLOT SIDE. This
    // fixture carries no runtime facts, so the runtime position draws the `runtime-missing`
    // sentence rather than a scale, and a sentence is a notice, which is a slot a theme fills.
    // The channel does not gain it: no collector can reach a channel before M5, so the position
    // is not mounted there at all.
    expect(operation).toEqual([
      'AppShell',
      'NavTree',
      'CommandPalette',
      'OperationHeader',
      'ParamTable',
      'ResponseList',
      'StateNotice',
    ]);
    expect(operation.length - channel.length).toBe(3);
  });

  it('should have a case for every name in the registry, so the freeze rests on evidence', () => {
    // Given, the rule this file exists for: a slot is not frozen until a case drives it through
    // the renderer. The count is checked from the other end, so a name added to the registry
    // without a case fails here rather than shipping as a promise.
    const cases = new Set<SlotName>([
      'AppShell',
      'NavTree',
      'CommandPalette',
      'DocumentOverview',
      'SchemaPage',
      'OperationHeader',
      'RuntimePanel',
      'ProvenanceTag',
      'DriftCard',
      'ParamTable',
      'ResponseList',
      'CodeSample',
      'SchemaTree',
      'ShapeForm',
      'AuthPanel',
      'ServerSelect',
      'SendButton',
      'ResponseView',
      'StreamLog',
      'HealthScore',
      'StateNotice',
    ]);

    // When
    const uncovered = SLOT_NAMES.filter((name) => !cases.has(name));

    // Then
    expect(uncovered).toEqual([]);
    expect(cases.size).toBe(SLOT_NAMES.length);
  });
});
