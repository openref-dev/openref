/**
 * The document overview: the page a reader lands on.
 *
 * IT IS A SLOT SINCE `TX-SLOTWIRE`, AND THE REASON IS ARITHMETIC. A reader can open three kinds
 * of page and the registry named components for one of them. A theme that could replace every
 * part of a node page and nothing at all of the page a reader arrives at is a contract with a
 * hole in the middle, and adding the name is cheap now and a major version later.
 *
 * THE HEALTH PANEL ARRIVES AS CHILDREN. It is a position of its own, `HealthScore`, and it is the
 * one that renders on the server and is adopted rather than drawn in the browser, per SPEC 7.2.
 * Passing it in means a theme that replaces this page keeps it without knowing any of that.
 *
 * THE TOPOLOGY SECTION IS DRAWN HERE AND NOT ON A PAGE OF ITS OWN, per SPEC 9.5, and the reason is
 * a measurement rather than a taste. A ninth `PageKind` is a dispatch branch, an adopt stub, a
 * route, a tab label and two total records, and at `T052` the first paint had 318 bytes of
 * headroom and the default theme 446. This position has been server resolved and adopted since
 * `TX-ADOPT`, so markup inside it costs the browser nothing at all, which is what made the section
 * affordable where the page was not. The precedent is `T050`'s: a channel is the node page rather
 * than a ninth kind.
 */

import { h, type VNode } from 'vue';
import { MarkdownBlock } from './MarkdownBlock';
import { ProvenanceTag } from './ProvenanceTag';
import { nodeHref } from '../page/domain/links';
import type { IRTopology, IRTopologyEndpoint } from '@openref/core';

/**
 * What names the topology as a source of facts, in the string `ProvenanceTag` prints.
 *
 * It is one name because there is one producer of an edge's provenance: the edge carries its own
 * `confidence`, and what a reader wants beside the level is where such a fact comes from at all.
 */
const TOPOLOGY_COLLECTOR = 'topology';

/**
 * One end of an edge, as a link when it resolved to a node and as plain text when it did not.
 *
 * THE DIFFERENCE IS THE FEATURE RATHER THAN A FALLBACK. `IRTopologyEndpoint.nodeId` is set only
 * where the graph actually found the thing named: a service name resolves to nothing by
 * definition, a node id from a service nobody federated in resolves to nothing, and an event name
 * two channels answer is left unresolved on purpose. Drawing an unresolved end as a link would be
 * the page claiming a page exists for it.
 *
 * @param endpoint - The end, as `buildTopology` resolved it
 * @param basePath - Where the reference is mounted
 * @returns The link or the text
 */
function endpointNode(endpoint: IRTopologyEndpoint, basePath: string): VNode {
  return endpoint.nodeId === undefined
    ? h('span', { class: 'oref-topology-name' }, endpoint.label)
    : h(
        'a',
        { class: 'oref-topology-name', href: nodeHref(endpoint.nodeId, basePath) },
        endpoint.label,
      );
}

/**
 * The graph of SPEC 9, drawn as an adjacency list.
 *
 * IT IS AN ADJACENCY LIST AND NOT A DRAWN GRAPH, which answers three of this task's four test
 * clauses at once. A cycle is three groups pointing at each other rather than a walk that has to
 * know when to stop; a graph of five hundred edges is five hundred rows at a constant nesting
 * depth rather than a layout whose cost grows with the shape; and every edge is drawn exactly
 * once, so nothing is dropped for being awkward to place.
 *
 * A DEAD END IS SAID IN WORDS. `deadEnd` means nothing at all leaves the target, which is the
 * whole point of drawing the edge: an event nobody consumes is a fact about the estate, and the
 * one thing this section must never do is make it look consumed. The words are in the markup
 * rather than in a stylesheet's generated content, for the reason `ProvenanceTag` states about
 * its own code: a fact that vanishes when the stylesheet does not arrive is not a fact a reader
 * can rely on.
 *
 * @param topology - The graph, already grouped and ordered by `buildTopology`
 * @param basePath - Where the reference is mounted
 * @returns The section
 */
function topologySection(topology: IRTopology, basePath: string): VNode {
  return h('section', { class: 'oref-section oref-section-topology' }, [
    h('h2', { class: 'oref-section-title' }, 'Topology'),
    h(
      'ul',
      { class: 'oref-topology' },
      topology.groups.map((group) =>
        h('li', { class: 'oref-topology-node', key: `${group.from.kind} ${group.from.name}` }, [
          endpointNode(group.from, basePath),
          h(
            'ul',
            { class: 'oref-topology-edges' },
            group.edges.map((edge) =>
              h(
                'li',
                {
                  class: 'oref-topology-edge',
                  // THE CONFIDENCE IS IN THE KEY BECAUSE IT IS IN THE EDGE'S OWN IDENTITY.
                  // `orderRelationships` folds two edges only when every member matches, so one
                  // declared and one inferred edge between the same pair are two rows, and a key
                  // that left the level out would make them one key for two siblings.
                  key: `${edge.type} ${edge.to.kind} ${edge.to.name} ${edge.confidence}`,
                },
                [
                  h('span', { class: 'oref-topology-type' }, edge.type),
                  endpointNode(edge.to, basePath),
                  edge.deadEnd ? h('span', { class: 'oref-topology-dead' }, 'dead end') : null,
                  h(ProvenanceTag, {
                    confidence: edge.confidence,
                    collector: TOPOLOGY_COLLECTOR,
                  }),
                ],
              ),
            ),
          ),
        ]),
      ),
    ),
  ]);
}

/**
 * Renders the overview of one document.
 *
 * @param props - What the document says about itself, and the graph it declares
 * @param context - Vue's second argument, for the children this position is handed
 * @returns The article
 */
export function DocumentOverview(
  props: {
    readonly title: string;
    readonly descriptionHtml: string;
    readonly servers: readonly string[];
    readonly basePath: string;
    /**
     * The topology graph of SPEC 9, or null when the document declares no edge.
     *
     * ADDITIVE, the `CommandPalette.degraded` shape: a position reads the props it declares, so a
     * theme that has never heard of this one still draws every overview it drew yesterday.
     */
    readonly topology?: IRTopology | null;
  },
  context: { readonly slots: { default?: () => VNode[] } },
): VNode {
  const topology = props.topology ?? null;

  return h('article', { class: 'oref-overview' }, [
    h('h1', { class: 'oref-title' }, props.title),
    h(MarkdownBlock, { html: props.descriptionHtml }),
    props.servers.length === 0
      ? null
      : h('section', { class: 'oref-section oref-section-servers' }, [
          h('h2', { class: 'oref-section-title' }, 'Servers'),
          h(
            'ul',
            { class: 'oref-server-list' },
            props.servers.map((url) =>
              h('li', { class: 'oref-server', key: url }, [h('code', {}, url)]),
            ),
          ),
        ]),
    topology === null ? null : topologySection(topology, props.basePath),
    // THE HEALTH PANEL LIVES HERE AND NOWHERE ELSE, per SPEC 7.3. The report is a statement
    // about the whole document and this is the page about the whole document; a node page shows
    // the same report one subject at a time, inside its runtime block. It is absent rather than
    // scored zero when nothing measured the document, which is the same rule as the runtime
    // block's: nobody asked and nothing is claimed.
    ...(context.slots.default?.() ?? []),
  ]);
}
