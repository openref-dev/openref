import { h, type VNode } from 'vue';
import type { IRTopology, IRTopologyEndpoint } from '@openref/vue';
import ProvenanceTag from './ProvenanceTag';
import { nodeHref } from '../links';

/**
 * The overview: what the document says about itself, its servers, the topology, and Health.
 *
 * THE HEALTH PANEL ARRIVES AS CHILDREN AND IS NOT DRAWN FROM DATA HERE. It is a position of its
 * own, `HealthScore`, resolved during the server render, so this one places it and never inspects
 * it. A theme that forgot to render its children would drop the panel and the page would look
 * finished, which is why the reference's own overview draws the same way.
 *
 * THE GRAPH IS DRAWN HERE FOR EXACTLY THAT REASON, AND IT IS THE SAME TRAP ONE PROP LATER.
 * `T052` put the topology of SPEC 9 inside this position, and this theme replaces the position,
 * so a theme that only placed its children would show a reader a finished looking overview with
 * the whole feature missing and nothing anywhere saying so. The boundary sweep cannot report it
 * either: a class drawn inside an overridden position never survives to be a boundary name, which
 * is why this is a component change rather than a stylesheet one.
 *
 * The description is HTML the server rendered and sanitized, per SPEC 12, so it is set rather than
 * parsed here. There is no second sanitizer in a theme and there must not be: two sanitizers is
 * one policy nobody owns.
 */
function endpoint(end: IRTopologyEndpoint, basePath: string): VNode {
  // A LINK ONLY WHERE THE GRAPH FOUND SOMETHING. `nodeId` is set when the end named a node this
  // document holds, and left unset for a service name, for a node from a service nobody federated
  // in, and for an event address two channels answer. Linking an unresolved end would be this
  // theme claiming a page exists for it.
  return end.nodeId === undefined
    ? h('span', { class: 'tt-topology-name' }, end.label)
    : h('a', { class: 'tt-topology-name', href: nodeHref(end.nodeId, basePath) }, end.label);
}

/**
 * The mark for an end that leads out of what this document knows, per SPEC 9.5.
 *
 * A DIFFERENT FACT FROM A MISSING LINK. `nodeId` is unset for several different reasons and only
 * some of them mean the target is not here: a service nobody federated in and a name no node or
 * channel of this document answers. `outside` is the one that says which, and drawing the two
 * alike would leave a reader unable to tell the boundary of the federation from the shape of the
 * estate. Words rather than a colour, the rule this theme applies to every mark it draws.
 *
 * AN `undeclared-event` END GETS ITS OWN MARK AND NOT THIS ONE, per SPEC 9.5. The merge already
 * established that no source document of the federation declares the event, which is more than
 * "not in this document", so the code stands in for the phrase and the phrase rides in the title.
 * A three letter code because the provenance marks of this theme carry one, and an `abbr` because
 * that is the element for a code standing for a longer thing.
 */
function outsideMark(end: IRTopologyEndpoint): VNode | null {
  if (end.kind === 'undeclared-event') {
    return h(
      'abbr',
      {
        class: 'tt-topology-undeclared',
        title: 'No document in this federation declares this event',
      },
      'UND',
    );
  }

  return end.outside ? h('span', { class: 'tt-topology-outside' }, 'OUTSIDE') : null;
}

function topologyStrip(topology: IRTopology, basePath: string): VNode {
  return h('section', { class: 'tt-strip-block' }, [
    h('h2', { class: 'tt-strip-head' }, 'TOPOLOGY'),
    h(
      'ul',
      { class: 'tt-topology-list' },
      topology.groups.map((group) =>
        h('li', { class: 'tt-topology-node', key: `${group.from.kind} ${group.from.name}` }, [
          endpoint(group.from, basePath),
          outsideMark(group.from),
          h(
            'ul',
            { class: 'tt-topology-edges' },
            group.edges.map((edge) =>
              h(
                'li',
                {
                  class: 'tt-topology-row',
                  // THE CONFIDENCE IS IN THE KEY BECAUSE IT IS IN THE EDGE'S OWN IDENTITY, the
                  // same reason the reference overview gives. `orderRelationships` folds two edges
                  // only when every member matches, so one declared and one derived edge between
                  // the same pair are two rows, and a key that left the level out would hand two
                  // siblings one key.
                  key: `${edge.type} ${edge.to.kind} ${edge.to.name} ${edge.confidence}`,
                },
                [
                  h('span', { class: 'tt-topology-type' }, edge.type),
                  endpoint(edge.to, basePath),
                  outsideMark(edge.to),
                  // A dead end is words rather than a colour, the rule this theme applies to every
                  // mark it draws: an event nobody consumes has to read as one on a monochrome
                  // print and with no stylesheet at all.
                  edge.deadEnd ? h('span', { class: 'tt-topology-dead' }, 'DEAD END') : null,
                  h(ProvenanceTag, { confidence: edge.confidence, collector: 'topology' }),
                ],
              ),
            ),
          ),
        ]),
      ),
    ),
  ]);
}

export default function DocumentOverview(
  props: {
    readonly title: string;
    readonly descriptionHtml: string;
    readonly servers: readonly string[];
    readonly basePath: string;
    readonly topology?: IRTopology | null;
  },
  context: { readonly slots: { readonly default?: () => VNode[] } },
): VNode {
  const topology = props.topology ?? null;

  return h('article', { class: 'tt-overview' }, [
    h('h1', { class: 'tt-overview-title' }, props.title),
    props.descriptionHtml === ''
      ? null
      : h('div', { class: 'tt-overview-prose tt-prose', innerHTML: props.descriptionHtml }),
    props.servers.length === 0
      ? null
      : h('section', { class: 'tt-strip-block' }, [
          h('h2', { class: 'tt-strip-head' }, 'SERVERS'),
          h(
            'ul',
            { class: 'tt-server-list' },
            props.servers.map((server) =>
              h('li', { class: 'tt-server-row', key: server }, [
                h('code', { class: 'tt-server-url' }, server),
              ]),
            ),
          ),
        ]),
    topology === null ? null : topologyStrip(topology, props.basePath),
    h('div', { class: 'tt-overview-health' }, context.slots.default?.() ?? []),
  ]);
}
