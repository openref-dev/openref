/**
 * `llms.txt` and `llms-full.txt`, as SPEC 18 asks for them: cheap on top of a good IR.
 *
 * TWO FILES AT TWO DEPTHS AND ONE SET OF FACTS. The index names every address a reader can go to
 * and one line about each; the full text carries what is at those addresses, so a reader that
 * cannot follow a link still has the contract. Nothing is invented in either: every line is a
 * value the IR already carries, and a value the document did not write produces no line at all
 * rather than an empty one, which is the same rule the reference's own pages follow.
 *
 * TITLES COME FROM `materializeNode` AND ADDRESSES FROM `links.ts`, both in `@openref/render`,
 * which is the whole reason STANDARDS 3.5 gives this package that edge. A file naming an operation
 * differently from the page it links to would be two titles for one operation, and an address
 * spelled here rather than built there would be the broken link `links.ts` exists to prevent.
 *
 * DETERMINISTIC BY CONSTRUCTION RATHER THAN BY SORTING. Both files walk `document.nodes` and
 * `document.schemas` in the order the IR holds them, and that order is a function of the document
 * the normalizer produced. So two runs over one document hash write one string with nothing being
 * ordered on the way out, and a shuffled source that normalizes to the same hash writes the same
 * bytes. `determinism.spec.ts` asserts the second, which is the one that could be false.
 *
 * ONE `plainArtefactText` CALL PER FILE, AT THE END, per SPEC 19.1 as extended by `T043`. A plain
 * text artefact has no element to isolate a bidirectional override on and no syntax to escape a
 * control character into, so it gets the property by removal, once, over the finished text.
 *
 * A NODE MARKED `audience: internal` IS IN NEITHER FILE, AND THE FILTER IS HERE RATHER THAN ON A
 * SURFACE. Both files are served twice, at their HTTP address and as an MCP resource, and the
 * second blind review of `T058` read `POST /admin/impersonate` back through
 * `resources/read openref://llms-full.txt` on a booted guarded application while `tools/list` on
 * the same address withheld it. Filtering on the MCP path alone would have closed that hole and
 * opened another: one document with two spellings, which is the defect SPEC 18.1 refuses one
 * paragraph further down about the two generators. So the filter is in the file, `agentExposure`
 * is the one place that decides it, and both routes serve the same bytes because they call the
 * same function. A machine crawlable file cannot have a version per reader, so it takes the
 * conservative audience; the operation page itself is unchanged and is still drawn for anyone the
 * guard of SPEC 19.6 admitted, which SPEC 18.1 records as the price rather than as an oversight.
 */

import {
  plainArtefactText,
  type IRDocument,
  type IRNode,
  type IRSchema,
  type IRSchemaSlot,
} from '@openref/core';
import { materializeNode, nodeHref, schemaHref } from '@openref/render';
import { oneLine, plainSummary } from './summary';
import { agentExposure, isMutatingMethod } from '../../mcp/domain/exposure';
import type { ResolvedAgentOptions } from '../../mcp/domain/agent-options';

/** What both builders need to name an address and to say what is switched on. */
export interface LlmsTextOptions {
  /** Mount point, already normalized, such as `/docs`. */
  readonly basePath: string;
  /** The two switches of SPEC 18.1, so the index offers only what actually answers. */
  readonly agent: ResolvedAgentOptions;
}

/** Segment of the machine readable index, per SPEC 13.3. */
export const LLMS_SEGMENT = 'llms.txt';

/** Segment of the full reference text, per SPEC 13.3. */
export const LLMS_FULL_SEGMENT = 'llms-full.txt';

/** Segment the MCP endpoint of SPEC 18 answers on, per SPEC 13.3. */
export const MCP_SEGMENT = 'mcp';

/**
 * The one sentence at the top of both files.
 *
 * IT FALLS BACK TO A SENTENCE ABOUT THE DOCUMENT RATHER THAN TO NOTHING, because the line is the
 * blockquote the `llms.txt` convention puts under the heading and an empty one reads as a document
 * with no purpose rather than as a document whose author wrote no description.
 *
 * @param document - The normalized document
 * @returns The summary line, without the marker
 */
function documentSummary(document: IRDocument): string {
  const written = plainSummary(document.info.description ?? '');
  if (written !== '') return written;

  // THE FALLBACK INTERPOLATES TWO DOCUMENT VALUES AND WAS THE ONE PLACE THAT DID SO RAW, found by
  // the blind review of `T059` measuring two `<a href="ghost">` anchors that survived the first
  // fix. `plainSummary` guards the branch above, because it strips markdown links and collapses
  // whitespace; this branch calls neither, so a title carrying a line break split the blockquote
  // into rows and a title carrying link syntax made one of them a link.
  return `API reference for ${oneLine(document.info.title)} ${oneLine(document.info.version)}.`;
}

/**
 * What one node is called and where it lives, as one list row.
 *
 * @param node - The node
 * @param document - The document it belongs to, for the title
 * @param basePath - Mount point
 * @returns The markdown list row
 */
function nodeRow(node: IRNode, document: IRDocument, basePath: string): string {
  const title = oneLine(materializeNode(node, document).title);
  // THE NOTE IS DROPPED WHEN IT IS THE TITLE. `materializeNode` titles an operation by its summary
  // when it has one, so a note taken from the same summary would print the same words twice on
  // every row of the common case. The same defect `@openref/static` records against its own file.
  const summary = plainSummary(node.summary ?? '');
  const note = summary === title ? '' : summary;

  return `- [${title}](${nodeHref(node.id, basePath)})${note === '' ? '' : `: ${note}`}`;
}

/**
 * The machine readable addresses this mount answers on, as list rows.
 *
 * ONLY WHAT IS ACTUALLY SWITCHED ON IS OFFERED. The index is read by something that will follow
 * what it finds, so naming an address that answers 403 would send every reader of the file to a
 * refusal. The specification address is named by family, per SPEC 13.3: an events document is
 * never offered under a name that says OpenAPI.
 *
 * @param document - The normalized document
 * @param options - Mount point and the two switches
 * @returns The rows, which are never empty because the specification is always served
 */
function machineRows(document: IRDocument, options: LlmsTextOptions): readonly string[] {
  const at = (suffix: string): string => `${options.basePath}/${suffix}`;
  const events = document.kind === 'events';
  const family = events ? 'asyncapi' : 'openapi';
  const rows = [
    `- [${events ? 'AsyncAPI' : 'OpenAPI'} document](${at(`${family}.json`)})`,
    `- [Documentation Health report](${at('health')})`,
  ];

  if (options.agent.llmsTxt) {
    rows.push(`- [Full reference text](${at(LLMS_FULL_SEGMENT)})`);
  }
  if (options.agent.mcp) {
    rows.push(
      `- [MCP endpoint, JSON-RPC over POST](${at(MCP_SEGMENT)}): authentication is required, ` +
        'per SPEC 18',
    );
  }

  return rows;
}

/**
 * `llms.txt`: what this reference is, and every address a reader can go to.
 *
 * @param document - The normalized document
 * @param options - Mount point and the two switches of SPEC 18.1
 * @returns The file contents
 *
 * @example
 * buildLlmsIndex(document, { basePath: '/docs', agent: { llmsTxt: true, mcp: false } });
 */
export function buildLlmsIndex(document: IRDocument, options: LlmsTextOptions): string {
  const lines = [
    `# ${oneLine(document.info.title)}`,
    '',
    `> ${documentSummary(document)}`,
    '',
    `Version: ${oneLine(document.info.version)}`,
    `Document hash: ${document.hash}`,
  ];

  const { operations, channels } = agentExposure(document);

  if (operations.length > 0) {
    lines.push('', '## Operations', '');
    for (const node of operations) lines.push(nodeRow(node, document, options.basePath));
  }

  if (channels.length > 0) {
    lines.push('', '## Channels', '');
    for (const node of channels) lines.push(nodeRow(node, document, options.basePath));
  }

  if (document.schemas.size > 0) {
    lines.push('', '## Schemas', '');
    for (const schema of document.schemas.values()) {
      lines.push(
        `- [${oneLine(schema.name ?? schema.id)}](${schemaHref(schema.id, options.basePath)})`,
      );
    }
  }

  lines.push('', '## Machine readable', '', ...machineRows(document, options), '');

  return plainArtefactText(lines.join('\n'));
}

/**
 * One schema slot as the short name a reader recognises.
 *
 * @param slot - The slot at a use site, or nothing
 * @returns The schema name, `inline` with its type, or null when there is no schema at all
 */
function slotName(slot: IRSchemaSlot | undefined): string | null {
  if (slot === undefined) return null;
  if (slot.kind === 'named') return oneLine(slot.schemaId);

  const type = slot.schema.normalized?.type;
  if (type === undefined) return 'inline';

  return oneLine(`inline ${Array.isArray(type) ? type.join(' | ') : String(type)}`);
}

/**
 * Every runtime fact one node carries, each with its confidence and its collector.
 *
 * NOTHING IS PRINTED WITHOUT ITS PROVENANCE, which is CLAUDE.md's rule and is the whole reason
 * this file exists rather than a JSON dump: a machine reader of these lines is deciding what to
 * trust, and a scope printed without `declared` beside it is a claim this project does not make.
 *
 * @param node - The node
 * @returns The lines, empty when no collector said anything about it
 */
function runtimeLines(node: IRNode): readonly string[] {
  const runtime = node.runtime;
  if (runtime === undefined) return [];

  const lines: string[] = [];
  const fact = (label: string, value: string, confidence: string, collector: string): void => {
    lines.push(`- ${label}: ${oneLine(value)} (${confidence}, ${oneLine(collector)})`);
  };

  if (runtime.scopes !== undefined) {
    fact(
      'scopes',
      runtime.scopes.value.join(', '),
      runtime.scopes.confidence,
      runtime.scopes.collector,
    );
  }
  if (runtime.roles !== undefined) {
    fact(
      'roles',
      runtime.roles.value.join(', '),
      runtime.roles.confidence,
      runtime.roles.collector,
    );
  }
  if (runtime.rateLimit !== undefined) {
    const limit = runtime.rateLimit.value;
    fact(
      'rate limit',
      `${String(limit.limit)} per ${String(limit.ttlMs)} ms`,
      runtime.rateLimit.confidence,
      runtime.rateLimit.collector,
    );
  }
  if (runtime.timeout !== undefined) {
    fact(
      'timeout',
      `${String(runtime.timeout.value.ms)} ms`,
      runtime.timeout.confidence,
      runtime.timeout.collector,
    );
  }
  if (runtime.requiredHeaders !== undefined) {
    fact(
      'required headers',
      runtime.requiredHeaders.value.join(', '),
      runtime.requiredHeaders.confidence,
      runtime.requiredHeaders.collector,
    );
  }
  if (runtime.statusCode !== undefined) {
    fact(
      'success status',
      String(runtime.statusCode.value),
      runtime.statusCode.confidence,
      runtime.statusCode.collector,
    );
  }
  if (runtime.streaming !== undefined) {
    const streaming = runtime.streaming.value;
    fact(
      'streaming',
      `${streaming.transport}${slotName(streaming.itemSchema) === null ? '' : ` of ${String(slotName(streaming.itemSchema))}`}`,
      runtime.streaming.confidence,
      runtime.streaming.collector,
    );
  }
  for (const guard of runtime.guards ?? []) {
    lines.push(
      `- guard: ${oneLine(guard.name)} (${guard.confidence}, ${oneLine(guard.collector)})`,
    );
  }

  return lines.length === 0 ? [] : ['Runtime:', ...lines];
}

/**
 * One operation, in full.
 *
 * @param node - The operation
 * @param document - The document it belongs to
 * @param basePath - Mount point
 * @returns The lines for this operation
 */
function operationSection(
  node: Extract<IRNode, { kind: 'operation' }>,
  document: IRDocument,
  basePath: string,
): readonly string[] {
  const lines = [
    // THE HEADING IS THE METHOD AND THE PATH, WHICH EVERY OPERATION HAS AND WHICH NAMES IT
    // UNIQUELY, and the title is a line beneath it rather than the heading. The two are different
    // facts: a machine reader addresses the operation by the first and a person recognises it by
    // the second. The title comes from `materializeNode` beside the channel heading above, so the
    // rule holds for both node kinds: no name in either of these files is derived here.
    `### ${node.method.toUpperCase()} ${oneLine(node.path)}`,
    '',
    `Title: ${oneLine(materializeNode(node, document).title)}`,
    `Address: ${nodeHref(node.id, basePath)}`,
    `Mutating: ${isMutatingMethod(node.method) ? 'yes' : 'no'}`,
  ];

  if (node.operationId !== undefined) lines.push(`Operation id: ${oneLine(node.operationId)}`);
  if (node.deprecated) lines.push('Deprecated: yes');
  if (node.tags.length > 0) lines.push(`Tags: ${node.tags.map(oneLine).join(', ')}`);
  if (node.summary !== undefined) lines.push(`Summary: ${plainSummary(node.summary)}`);
  if (node.description !== undefined) lines.push(`Description: ${plainSummary(node.description)}`);

  if (node.security.length > 0) {
    const requirements = node.security.map((requirement) =>
      requirement.scopes.length === 0
        ? oneLine(requirement.schemeId)
        : `${oneLine(requirement.schemeId)} (${requirement.scopes.map(oneLine).join(', ')})`,
    );
    lines.push(`Security: ${requirements.join('; ')}`);
  }

  if (node.parameters.length > 0) {
    lines.push('Parameters:');
    for (const parameter of node.parameters) {
      const schema = slotName(parameter.schema);
      lines.push(
        `- ${oneLine(parameter.name)} (${parameter.in}, ${parameter.required ? 'required' : 'optional'}` +
          `${schema === null ? '' : `, ${schema}`})` +
          (parameter.description === undefined ? '' : `: ${plainSummary(parameter.description)}`),
      );
    }
  }

  if (node.requestBody !== undefined) {
    const media = node.requestBody.content.map((entry) => {
      const schema = slotName(entry.schema);
      return schema === null
        ? oneLine(entry.mediaType)
        : `${oneLine(entry.mediaType)} of ${schema}`;
    });
    lines.push(
      `Request body (${node.requestBody.required ? 'required' : 'optional'}): ` +
        (media.length === 0 ? 'no declared media type' : media.join(', ')),
    );
  }

  if (node.responses.length > 0) {
    lines.push('Responses:');
    for (const response of node.responses) {
      const media = response.content.map((entry) => {
        const schema = slotName(entry.schema);
        return schema === null
          ? oneLine(entry.mediaType)
          : `${oneLine(entry.mediaType)} of ${schema}`;
      });
      lines.push(
        `- ${oneLine(response.statusCode)}${media.length === 0 ? '' : ` (${media.join(', ')})`}` +
          (response.description === undefined ? '' : `: ${plainSummary(response.description)}`),
      );
    }
  }

  const runtime = runtimeLines(node);
  if (runtime.length > 0) lines.push(...runtime);

  // Named here rather than left to the reader to notice, because a document is a document
  // whether or not any collector ever ran over it, and "no facts" and "no pass" are different.
  if (runtime.length === 0 && document.runtime !== undefined) {
    lines.push('Runtime: no collector stated anything about this operation.');
  }

  return [...lines, ''];
}

/**
 * One channel, in full. It is never a tool, per SPEC 18, and it is never hidden either.
 *
 * THE HEADING IS `materializeNode`'s TITLE AND NOTHING THIS FILE DERIVES, found by the blind
 * review of `T058`. It read `address ?? id` while `channelTitle` reads `title ?? address ?? id`,
 * so a channel that declares a title was `- [Order created feed]` in the index and
 * `### orders.created` here: two names for one channel, in two files a reader opens side by side,
 * which is exactly the defect the edge to `@openref/render` exists to prevent. The address is not
 * lost with the fix, it moves to a line of its own, because a title and an address are two facts
 * and the heading can only carry one.
 *
 * @param node - The channel
 * @param document - The document it belongs to, for the title
 * @param basePath - Mount point
 * @returns The lines for this channel
 */
function channelSection(
  node: Extract<IRNode, { kind: 'channel' }>,
  document: IRDocument,
  basePath: string,
): readonly string[] {
  const lines = [
    `### ${oneLine(materializeNode(node, document).title)}`,
    '',
    `Address: ${nodeHref(node.id, basePath)}`,
    'Mutating: not applicable, a channel is not called over HTTP',
  ];

  if (node.address !== undefined) lines.push(`Channel address: ${oneLine(node.address)}`);
  if (node.protocol !== undefined) lines.push(`Protocol: ${oneLine(node.protocol)}`);
  if (node.deprecated) lines.push('Deprecated: yes');
  if (node.tags.length > 0) lines.push(`Tags: ${node.tags.map(oneLine).join(', ')}`);
  if (node.summary !== undefined) lines.push(`Summary: ${plainSummary(node.summary)}`);
  if (node.description !== undefined) lines.push(`Description: ${plainSummary(node.description)}`);

  if (node.operations.length > 0) {
    lines.push('Operations:');
    for (const operation of node.operations) {
      lines.push(
        `- ${operation.direction}: ${operation.messageIds.map(oneLine).join(', ')}` +
          (operation.summary === undefined ? '' : ` (${plainSummary(operation.summary)})`),
      );
    }
  }

  if (node.messages.length > 0) {
    lines.push('Messages:');
    for (const message of node.messages) {
      const payload = slotName(message.payload);
      lines.push(
        `- ${oneLine(message.name ?? message.id)}` +
          (message.contentType === undefined ? '' : ` (${oneLine(message.contentType)})`) +
          (payload === null ? '' : ` of ${payload}`),
      );
    }
  }

  const runtime = runtimeLines(node);
  if (runtime.length > 0) lines.push(...runtime);

  return [...lines, ''];
}

/**
 * One named schema, as its top level shape.
 *
 * ONE LEVEL DEEP AND SAID SO. A schema tree can nest without bound and a reference can be
 * circular, per SPEC 5.4's cycle folding, so printing the whole of one is either a size nobody
 * bounded or a walk that does not terminate. What is printed is the level a reader needs to name
 * a field, and a property whose own type is a named schema names it, so the reader can look it up
 * in this same file.
 *
 * @param schema - The named schema
 * @param basePath - Mount point
 * @returns The lines for this schema
 */
function schemaSection(schema: IRSchema, basePath: string): readonly string[] {
  const body = schema.normalized;
  const lines = [
    `### ${oneLine(schema.name ?? schema.id)}`,
    '',
    `Address: ${schemaHref(schema.id, basePath)}`,
    `Dialect: ${schema.dialect}`,
  ];

  if (body?.description !== undefined) lines.push(`Description: ${plainSummary(body.description)}`);
  if (body?.type !== undefined) {
    lines.push(
      `Type: ${oneLine(Array.isArray(body.type) ? body.type.join(' | ') : String(body.type))}`,
    );
  }

  const properties = Object.entries(body?.properties ?? {});
  if (properties.length > 0) {
    const required = new Set(body?.required ?? []);
    lines.push('Properties:');
    for (const [name, property] of properties) {
      const reference = property.$ref ?? property.$cycle;
      const type =
        reference ??
        (property.type === undefined
          ? 'unstated'
          : Array.isArray(property.type)
            ? property.type.join(' | ')
            : String(property.type));
      lines.push(
        `- ${oneLine(name)} (${oneLine(type)}, ${required.has(name) ? 'required' : 'optional'})` +
          (property.description === undefined ? '' : `: ${plainSummary(property.description)}`),
      );
    }
  }

  return [...lines, ''];
}

/**
 * `llms-full.txt`: the whole reference as text, so a reader that follows no link still has it.
 *
 * @param document - The normalized document
 * @param options - Mount point and the two switches of SPEC 18.1
 * @returns The file contents
 *
 * @example
 * buildLlmsFull(document, { basePath: '/docs', agent: { llmsTxt: true, mcp: false } });
 */
export function buildLlmsFull(document: IRDocument, options: LlmsTextOptions): string {
  const lines = [
    `# ${oneLine(document.info.title)}`,
    '',
    `> ${documentSummary(document)}`,
    '',
    `Version: ${oneLine(document.info.version)}`,
    `Document hash: ${document.hash}`,
    '',
  ];

  if (document.runtime !== undefined) {
    const collectors = document.runtime.collectors;
    lines.push(
      `Runtime facts were collected by: ${collectors.length === 0 ? 'no collector' : collectors.map(oneLine).join(', ')}.`,
      'Every fact below carries its confidence and the collector that produced it, per SPEC 6.1.',
      '',
    );
  }

  const { operations, channels } = agentExposure(document);

  if (operations.length > 0) {
    lines.push('## Operations', '');
    for (const node of operations) {
      lines.push(...operationSection(node, document, options.basePath));
    }
  }

  if (channels.length > 0) {
    lines.push('## Channels', '');
    for (const node of channels) lines.push(...channelSection(node, document, options.basePath));
  }

  if (document.schemas.size > 0) {
    lines.push('## Schemas', '');
    for (const schema of document.schemas.values()) {
      lines.push(...schemaSection(schema, options.basePath));
    }
  }

  return plainArtefactText(lines.join('\n'));
}
