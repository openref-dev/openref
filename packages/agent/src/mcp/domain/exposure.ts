/**
 * Which nodes the MCP surface of SPEC 18 is allowed to talk about, and which it is not.
 *
 * ONE FILTER, ASKED ONCE, AND EVERY MCP ANSWER GOES THROUGH IT. SPEC 18 says a node marked
 * `audience: internal` is not exposed when MCP is on, and the failure mode of writing that rule
 * three times, once for the tool list, once for a tool call and once for the drift report, is that
 * two of the three agree and the third is the leak. So the exposed set is computed here and the
 * three consumers read it rather than each asking the question.
 *
 * A DRIFT FINDING ON AN INTERNAL NODE IS AN INTERNAL NODE, per the `T058` amendment in
 * `ai-docs/BUILD-AMENDMENTS.md`. The health report is the one answer where the subject is a node id
 * rather than a node, so it is the one where the filter is easy to forget and impossible to see
 * having been forgotten: a report naming `POST /admin/impersonate` in a `subject` string has
 * exposed the operation just as surely as a tool would have.
 *
 * IT IS NOT AN ACCESS CONTROL AND THE DIFFERENCE IS WRITTEN DOWN IN SPEC 18.1. Who may reach the
 * reference at all is `visibility` and the guard of SPEC 19.6; this is a per node documentation
 * marking, it filters the MCP surface because SPEC 18 asks for exactly that, and it deliberately
 * does not filter the pages or the two text files, which show what the reference's own HTML shows.
 */

import type { IRDocument, IRNode } from '@openref/core';

/**
 * The extension `@ApiAudience` writes, per SPEC 13.4.
 *
 * SPELLED HERE AND CHECKED AGAINST `@openref/nest`'s OWN CONSTANT BY A CASE, rather than imported:
 * `agent` may not reach `nest`, per STANDARDS 3.5, and the decorator that writes the key lives
 * there. Two spellings of one key is a filter that silently matches nothing, which on this
 * question means exposed, so the agreement is asserted rather than assumed.
 */
export const AUDIENCE_EXTENSION = 'x-openref-audience';

/** The audience value that keeps a node off the MCP surface, per SPEC 18. */
export const INTERNAL_AUDIENCE = 'internal';

/**
 * Whether one node is marked for internal eyes only.
 *
 * @param node - The node
 * @returns True when its `x-openref-audience` extension reads `internal`
 */
export function isInternalAudience(node: IRNode): boolean {
  return node.extensions?.[AUDIENCE_EXTENSION] === INTERNAL_AUDIENCE;
}

/** What the MCP surface may talk about, computed once per document. */
export interface AgentExposure {
  /** Operations a tool may be built for, in document order. */
  readonly operations: readonly Extract<IRNode, { kind: 'operation' }>[];
  /** Channels the surface may mention, in document order. Never tools, per SPEC 18. */
  readonly channels: readonly Extract<IRNode, { kind: 'channel' }>[];
  /** Ids of every node held back, so a consumer can prove the filter ran rather than assume it. */
  readonly withheldNodeIds: ReadonlySet<string>;
}

/**
 * Splits a document's nodes into what MCP may expose and what it may not.
 *
 * @param document - The normalized document
 * @returns The exposed operations and channels, and the ids of everything withheld
 */
export function agentExposure(document: IRDocument): AgentExposure {
  const operations: Extract<IRNode, { kind: 'operation' }>[] = [];
  const channels: Extract<IRNode, { kind: 'channel' }>[] = [];
  const withheldNodeIds = new Set<string>();

  for (const node of document.nodes.values()) {
    if (isInternalAudience(node)) {
      withheldNodeIds.add(node.id);
      continue;
    }

    if (node.kind === 'operation') operations.push(node);
    else channels.push(node);
  }

  return { operations, channels, withheldNodeIds };
}

/** HTTP methods that change nothing, per RFC 9110's safe method definition. */
export const SAFE_HTTP_METHODS: readonly string[] = ['get', 'head', 'options', 'trace'];

/**
 * Whether performing an operation would change something on the other side.
 *
 * THE QUESTION IS ASKED OF THE METHOD AND OF NOTHING ELSE, because the method is the only thing
 * the document states about it. A handler name, a path segment reading `delete` or a summary
 * saying "removes" are prose, and deciding from them would be the guess CLAUDE.md refuses. An
 * unenumerated method, which OpenAPI 3.2's `additionalOperations` allows, is not on the safe list
 * and is therefore treated as mutating: the marking exists so a reader confirms before acting, and
 * the closed direction on an unknown method is to ask.
 *
 * @param method - The operation's method, lowercase as the IR carries it
 * @returns True when the method is not one of the safe ones
 */
export function isMutatingMethod(method: string): boolean {
  return !SAFE_HTTP_METHODS.includes(method.toLowerCase());
}
