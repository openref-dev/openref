/**
 * The tools the MCP endpoint of SPEC 18 lists, one per exposed operation.
 *
 * A TOOL DESCRIBES AN OPERATION AND NEVER PERFORMS ONE, per SPEC 18.1. Sending a request is the
 * runner and the same origin proxy of SPEC 14.5, which have an allowlist built from the document's
 * own servers and an SSRF defence behind it; a documentation endpoint that also forwarded calls
 * would be a second one of those, written by whoever added a tool. So `tools/call` answers with the
 * contract of the operation it names, out of the IR this process already holds.
 *
 * WHICH MAKES THE MARKING SPEC 18 ASKS FOR A FIELD RATHER THAN AN ANNOTATION, and the difference
 * is honesty towards the client. MCP's `annotations` describe the tool: this one reads and returns
 * documentation, so `readOnlyHint` is true and `openWorldHint` is false, and a tool claiming to be
 * destructive while reading a map would be a lie a client renders as a warning. The requirement
 * "mutating methods are marked as requiring confirmation" is about the documented operation, so it
 * is carried as data, in `mutating` and `requiresConfirmation` on the tool and in the first line of
 * its description, where both a program and a person meet it.
 *
 * CHANNELS ARE NOT HERE, per SPEC 18, and the reason is in the shape rather than in a policy: a
 * tool is a thing an agent calls over HTTP and a channel is not one. They are not hidden either,
 * which SPEC 18.1 records: they are in `llms.txt`, in `llms-full.txt` and in the document resource.
 *
 * NEITHER IS A NODE MARKED `audience: internal`, and that filter is `agentExposure` rather than a
 * condition here, so that the tool list, a tool call and the health report cannot disagree.
 */

import { materializeNode, nodeHref } from '@openref/render';
import { agentExposure, isMutatingMethod } from './exposure';
import type { IRDocument, IRNode, IRParameter } from '@openref/core';

/** How a tool name is built from an operation, and what a name may contain. */
const UNSAFE_TOOL_NAME_CHARACTER = /[^a-zA-Z0-9_-]/g;

/** What one tool says about itself in `tools/list`. */
export interface AgentTool {
  readonly name: string;
  readonly description: string;
  /** JSON Schema of what `tools/call` accepts, which for a description tool is nothing. */
  readonly inputSchema: Readonly<Record<string, unknown>>;
  /** Truthful hints about this tool, per the note at the top of this file. */
  readonly annotations: {
    readonly title: string;
    readonly readOnlyHint: true;
    readonly destructiveHint: false;
    readonly openWorldHint: false;
  };
  /** Whether performing the documented operation would change something, per SPEC 18. */
  readonly mutating: boolean;
  /** Whether a client should confirm with a person before performing it, per SPEC 18. */
  readonly requiresConfirmation: boolean;
  /** The node this tool describes, so a call needs no second lookup. */
  readonly nodeId: string;
}

/**
 * The tool name for one operation.
 *
 * IT IS DERIVED FROM THE NODE ID, WHICH IS THE ONE IDENTIFIER SPEC 5.4 GUARANTEES IS UNIQUE. An
 * `operationId` is not: a document may write the same one twice, or none at all, and two tools
 * with one name is a client that can never reach the second. Characters outside the set MCP names
 * allow are replaced rather than dropped, so two ids that differ only in those characters stay
 * two names.
 *
 * @param nodeId - The node id
 * @returns A tool name
 */
export function toolNameOf(nodeId: string): string {
  return nodeId.replace(UNSAFE_TOOL_NAME_CHARACTER, '_');
}

/**
 * One parameter as a line of the tool's description.
 *
 * @param parameter - The parameter
 * @returns One line
 */
function parameterLine(parameter: IRParameter): string {
  return `- ${parameter.name} (${parameter.in}, ${parameter.required ? 'required' : 'optional'})`;
}

/**
 * The tools this document exposes, in document order.
 *
 * THE MOUNT POINT IS A PARAMETER AND NOT A DEFAULT, because the address in a tool's description is
 * a link a client may follow. Defaulting it to the root would print `/get-orders` for a reference
 * mounted on `/docs`, which is a 404 on every deployment that mounts anywhere but the root, and
 * the reference is the one thing this tool exists to point at.
 *
 * @param document - The normalized document
 * @param basePath - Mount point, already normalized
 * @returns One tool per exposed operation
 */
export function agentTools(document: IRDocument, basePath: string): readonly AgentTool[] {
  return agentExposure(document).operations.map((node) => {
    const mutating = isMutatingMethod(node.method);
    const title = materializeNode(node, document).title;
    const lines = [
      mutating
        ? `${node.method.toUpperCase()} ${node.path} changes data. Confirm with the person you ` +
          'are acting for before performing it. This tool only returns the documentation.'
        : `${node.method.toUpperCase()} ${node.path} is a safe method. This tool returns its ` +
          'documentation and performs nothing.',
    ];

    if (node.summary !== undefined) lines.push(node.summary);
    if (node.parameters.length > 0) {
      lines.push('Parameters:', ...node.parameters.map(parameterLine));
    }
    lines.push(`Reference page: ${nodeHref(node.id, basePath)}`);

    return {
      name: toolNameOf(node.id),
      description: lines.join('\n'),
      // NO INPUT, AND THE EMPTY OBJECT SAYS SO RATHER THAN THE FIELD BEING ABSENT. MCP requires an
      // input schema on every tool, and a tool that describes one fixed operation takes nothing:
      // accepting arguments here would invite a caller to believe they were sent somewhere.
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: {
        title,
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      mutating,
      requiresConfirmation: mutating,
      nodeId: node.id,
    };
  });
}

/**
 * What `tools/call` answers with for one operation: its contract, as text.
 *
 * @param node - The operation, already checked against the exposed set
 * @param document - The document it belongs to
 * @param basePath - Mount point, for the address of the reference page
 * @returns The lines of the answer
 */
export function toolCallText(
  node: Extract<IRNode, { kind: 'operation' }>,
  document: IRDocument,
  basePath: string,
): string {
  const mutating = isMutatingMethod(node.method);
  const lines = [
    `${node.method.toUpperCase()} ${node.path}`,
    `Title: ${materializeNode(node, document).title}`,
    `Mutating: ${mutating ? 'yes' : 'no'}`,
    `Requires confirmation before performing: ${mutating ? 'yes' : 'no'}`,
    `Reference page: ${nodeHref(node.id, basePath)}`,
    'This endpoint returns documentation and sends no request anywhere.',
  ];

  if (node.summary !== undefined) lines.push(`Summary: ${node.summary}`);
  if (node.description !== undefined) lines.push(`Description: ${node.description}`);
  if (node.deprecated) lines.push('Deprecated: yes');

  if (node.security.length > 0) {
    lines.push(
      `Security: ${node.security
        .map((requirement) =>
          requirement.scopes.length === 0
            ? requirement.schemeId
            : `${requirement.schemeId} (${requirement.scopes.join(', ')})`,
        )
        .join('; ')}`,
    );
  }

  if (node.parameters.length > 0) lines.push('Parameters:', ...node.parameters.map(parameterLine));

  if (node.responses.length > 0) {
    lines.push(
      'Responses:',
      ...node.responses.map(
        (response) =>
          `- ${response.statusCode}${response.description === undefined ? '' : `: ${response.description}`}`,
      ),
    );
  }

  return lines.join('\n');
}
