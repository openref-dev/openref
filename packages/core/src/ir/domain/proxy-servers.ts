/**
 * The server set both proxies of this project are pinned to, in one place.
 *
 * ONE RULE, TWO PROXIES, AND UNTIL THE PRE-M4 REVIEW THEY DISAGREED. `@openref/nest` builds its
 * SPEC 14.5 allowlist from the document's servers unioned with every node's own `servers`, which
 * is the right answer: OpenAPI lets an operation override `servers`, and an operation that does
 * so is exactly the case the override exists for, so a console that cannot reach it fails where
 * the document promises. `@openref/static` pinned its SPEC 16.2 upstreams from `document.servers`
 * alone, so a built site refused a request the same document served would have admitted. Neither
 * side was reading the other, and the union was written down nowhere, which is how a real
 * guarantee reads as an accident to whoever simplifies it next.
 *
 * THE ORDER IS THE DOCUMENT'S AND IT IS LOAD BEARING for the static side. SPEC 16.2 addresses a
 * generated rule as `u<N>`, N being the upstream's position in this order, so a set that reordered
 * itself between two builds would move every rule's address for no reason and break the byte for
 * byte repeat build property T039 proved.
 */

import type { IRDocument, IRServer } from './document.types';

/**
 * Every server a proxy of this project may be pinned to, document level, service level and node
 * level.
 *
 * Duplicates collapse on the first occurrence, compared by url alone: two declarations of one
 * address are one upstream however their descriptions differ, and the description is annotation
 * that no proxy reads. A node override carries no variables, so it contributes a bare url.
 *
 * SERVICE SERVERS JOIN THE UNION SINCE `T046`, per SPEC 14.5 as amended with SPEC 15.3. A merged
 * document is served with the caller's `servers`, empty by default per SPEC 15.1, and each
 * service keeps its own on its `IRService` entry, which is exactly where the federated console
 * reads them from. An allowlist that did not know them would refuse the request the same page's
 * console offers to send. On an unmerged document `services` is absent and nothing changes.
 *
 * @param document - The normalized document
 * @returns The servers, in document order, document level first, then per service in the sorted
 *          service order, then node overrides, without repeats
 *
 * @example
 * proxyServers(document).map((server) => server.url);
 */
export function proxyServers(document: IRDocument): readonly IRServer[] {
  const byUrl = new Map<string, IRServer>();

  for (const server of document.servers) {
    if (!byUrl.has(server.url)) byUrl.set(server.url, server);
  }

  for (const service of document.services ?? []) {
    for (const server of service.servers) {
      if (!byUrl.has(server.url)) byUrl.set(server.url, server);
    }
  }

  for (const node of document.nodes.values()) {
    for (const override of node.servers) {
      if (!byUrl.has(override.url)) byUrl.set(override.url, { url: override.url });
    }
  }

  return [...byUrl.values()];
}
