/**
 * What the three agent addresses of SPEC 13.3 answer, with nothing framework shaped in it.
 *
 * IT RETURNS A STATUS, A CONTENT TYPE AND TEXT, AND NOT A `ReferenceReply`. That type lives in
 * `@openref/nest` and this package may not see it, per STANDARDS 3.5; the mapping is three lines
 * on the other side. The gain is that every wording a caller of this surface can meet is decided
 * here, in one file, rather than split between a package that knows the rules and a package that
 * knows the router.
 *
 * OFF IS AN ANSWER RATHER THAN AN ABSENCE, by the `_proxy` precedent SPEC 13.3 states: a route
 * that exists only when a feature is on makes "off" and "no such address" the same 404 from
 * outside. All three addresses are registered on every mount and a switched off one answers 403
 * naming the option that switches it on.
 *
 * AUTHENTICATION IS NOT HERE, AND SPEC 18.1 SAYS WHERE IT IS. Every route of SPEC 13.3 passes the
 * `RouteAdmission` of SPEC 19.6 before this is reached, `mcp: true` on a mount with no guard is
 * refused at boot by `@openref/nest`, and a second scheme here would be the first place in this
 * repository that holds somebody else's secret.
 */

import { agentExposure } from '../../domain/exposure';
import { agentResources, readAgentResource } from '../../domain/resources';
import { agentTools, toolCallText, toolNameOf } from '../../domain/tools';
import { buildLlmsFull, buildLlmsIndex } from '../../../llms/domain/llms-text';
import { resolveAgentOptions, type AgentOptions } from '../../domain/agent-options';
import {
  JSONRPC_ERROR,
  jsonRpcError,
  jsonRpcResult,
  readJsonRpc,
  type JsonRpcRequest,
} from '../../domain/jsonrpc';
import type { IRDocument } from '@openref/core';
import type { ResolvedAgentOptions } from '../../domain/agent-options';

/**
 * The MCP protocol revision this endpoint answers `initialize` with.
 *
 * A DATE STRING BECAUSE THE PROTOCOL VERSIONS ITSELF THAT WAY, and it is a constant rather than an
 * echo of whatever the client asked for: answering a client's own number back would claim support
 * for a revision nobody here implemented, which is the class of defect this repository calls a
 * declared but never held promise.
 */
export const MCP_PROTOCOL_VERSION = '2025-06-18';

/** Name this server reports in the MCP handshake. */
export const MCP_SERVER_NAME = 'openref';

/** How the surface is built for one mounted document. */
export interface AgentSurfaceOptions {
  /** The normalized document, which everything served is derived from. */
  readonly document: IRDocument;
  /** Mount point, already normalized, without a trailing slash. */
  readonly basePath: string;
  /** What the host configured, if anything. */
  readonly agent?: AgentOptions;
}

/** What one agent address answers with, before a platform turns it into a response. */
export interface AgentSurfaceReply {
  readonly status: number;
  readonly contentType: string;
  readonly body: string;
}

/** Answers `<route>/llms.txt`, `<route>/llms-full.txt` and `<route>/mcp` for one document. */
export class AgentSurfaceService {
  private readonly document: IRDocument;
  private readonly basePath: string;
  private readonly resolved: ResolvedAgentOptions;

  /** Built once and kept: both files are a pure function of a document that does not change. */
  private index: string | null = null;
  private full: string | null = null;

  /** @param options - Document, mount point and what the host switched on */
  constructor(options: AgentSurfaceOptions) {
    this.document = options.document;
    this.basePath = options.basePath;
    this.resolved = resolveAgentOptions(options.agent);
  }

  /** The two switches as they were resolved, so a mount can report what it offers. */
  get options(): ResolvedAgentOptions {
    return this.resolved;
  }

  /**
   * `<route>/llms.txt`.
   *
   * @returns The index, or the 403 of a surface the host did not switch on
   */
  llmsIndex(): AgentSurfaceReply {
    if (!this.resolved.llmsTxt) return this.textFilesOff();

    this.index ??= buildLlmsIndex(this.document, this.textOptions());

    return { status: 200, contentType: 'text/plain; charset=utf-8', body: this.index };
  }

  /**
   * `<route>/llms-full.txt`.
   *
   * @returns The full text, or the 403 of a surface the host did not switch on
   */
  llmsFull(): AgentSurfaceReply {
    if (!this.resolved.llmsTxt) return this.textFilesOff();

    this.full ??= buildLlmsFull(this.document, this.textOptions());

    return { status: 200, contentType: 'text/plain; charset=utf-8', body: this.full };
  }

  /**
   * `<route>/mcp`.
   *
   * A NOTIFICATION IS ANSWERED WITH 202 AND AN EMPTY BODY, per JSON-RPC and MCP's HTTP transport:
   * a message with no id expects no result, and returning one would be a protocol error on this
   * side. `notifications/initialized` is the one every MCP client sends after the handshake.
   *
   * @param body - The request body, or nothing when the request carried none
   * @returns The JSON-RPC response, or the refusal
   */
  mcp(body: string | undefined): AgentSurfaceReply {
    if (!this.resolved.mcp) {
      return {
        status: 403,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({
          error:
            'the MCP endpoint is not enabled on this reference. It is off unless a host writes ' +
            'agent: { mcp: true }, per SPEC 18, and off refuses every request rather than ' +
            'answering an empty tool list',
        }),
      };
    }

    if (body === undefined || body.trim() === '') {
      return {
        status: 400,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({
          error:
            'the MCP endpoint takes one JSON-RPC 2.0 request in the body of a POST. A GET on ' +
            'this address is registered so that it answers about this endpoint rather than ' +
            'falling through to the operation page route, and it carries no body to read',
        }),
      };
    }

    const read = readJsonRpc(body);

    if (!read.ok) {
      return this.rpc(jsonRpcError(read.id ?? null, read.code, read.message));
    }

    const request = read.request;
    if (request.id === undefined) {
      // A notification. Nothing is answered, and the status says it was taken.
      return { status: 202, contentType: 'application/json; charset=utf-8', body: '' };
    }

    return this.rpc(this.answer(request, request.id));
  }

  /**
   * One JSON-RPC method.
   *
   * @param request - The request, already read
   * @param id - Its id, which a notification does not reach this method with
   * @returns The response to serialize
   */
  private answer(
    request: JsonRpcRequest,
    id: NonNullable<JsonRpcRequest['id']>,
  ): ReturnType<typeof jsonRpcResult> {
    switch (request.method) {
      case 'initialize':
        return jsonRpcResult(id, {
          protocolVersion: MCP_PROTOCOL_VERSION,
          // TOOLS AND RESOURCES AND NOTHING ELSE. Declaring a capability this endpoint does not
          // implement, prompts or sampling, would have a client call a method that answers
          // `methodNotFound`, which reads to it as a broken server rather than a narrow one.
          capabilities: { tools: {}, resources: {} },
          serverInfo: {
            name: MCP_SERVER_NAME,
            title: this.document.info.title,
            version: this.document.info.version,
          },
          // WHAT A CONSUMER MAY RELY ON, SAID BY THE SURFACE AND NOT ONLY BY THE SPECIFICATION.
          // `ai-docs/REMEDIATION.md` section 6 makes remediation a supported use of this surface,
          // and a supported use that only a document mentions is one a caller has to be told about
          // out of band. The three things it may depend on are named here because this is the one
          // message every MCP client reads before it does anything else.
          instructions:
            'This server answers questions about an API reference. It returns documentation ' +
            'and sends no request to the API it documents. A tool whose requiresConfirmation is ' +
            'true describes an operation that changes data. Remediation is a supported use: ' +
            'read openref://health for the versioned Documentation Health report, and ' +
            'openref://llms-full.txt for the whole reference as text. The report carries a ' +
            'version member, so refuse a version you do not read rather than treating it as an ' +
            'empty report.',
        });

      case 'ping':
        return jsonRpcResult(id, {});

      case 'tools/list':
        return jsonRpcResult(id, { tools: agentTools(this.document, this.basePath) });

      case 'tools/call':
        return this.callTool(request, id);

      case 'resources/list':
        return jsonRpcResult(id, { resources: agentResources(this.resolved) });

      case 'resources/read':
        return this.readResource(request, id);

      default:
        return jsonRpcError(
          id,
          JSONRPC_ERROR.methodNotFound,
          `this endpoint does not answer "${request.method}". It answers initialize, ping, ` +
            'tools/list, tools/call, resources/list and resources/read',
        );
    }
  }

  /**
   * `tools/call`: the contract of the named operation.
   *
   * THE NAME IS RESOLVED AGAINST THE EXPOSED SET AND NOT AGAINST THE DOCUMENT, which is the line
   * that keeps an internal node internal. Looking the node up in `document.nodes` and then asking
   * about its audience would be the same filter written twice, and the second copy is the one that
   * gets forgotten. An unknown name and a withheld one answer the same way, deliberately: a
   * different message would tell a caller that an operation it may not see exists.
   *
   * @param request - The request, for the tool name in its params
   * @param id - The request id
   * @returns The response
   */
  private callTool(
    request: JsonRpcRequest,
    id: NonNullable<JsonRpcRequest['id']>,
  ): ReturnType<typeof jsonRpcResult> {
    const name = request.params.name;
    if (typeof name !== 'string' || name === '') {
      return jsonRpcError(
        id,
        JSONRPC_ERROR.invalidParams,
        'tools/call names a tool in params.name',
      );
    }

    const exposed = agentExposure(this.document).operations;
    const node = exposed.find((operation) => toolNameOf(operation.id) === name);

    if (node === undefined) {
      return jsonRpcResult(id, {
        isError: true,
        content: [
          {
            type: 'text',
            text: `no tool named "${name}" is served by this reference`,
          },
        ],
      });
    }

    return jsonRpcResult(id, {
      content: [{ type: 'text', text: toolCallText(node, this.document, this.basePath) }],
      isError: false,
    });
  }

  /**
   * `resources/read`.
   *
   * @param request - The request, for the uri in its params
   * @param id - The request id
   * @returns The response
   */
  private readResource(
    request: JsonRpcRequest,
    id: NonNullable<JsonRpcRequest['id']>,
  ): ReturnType<typeof jsonRpcResult> {
    const uri = request.params.uri;
    if (typeof uri !== 'string' || uri === '') {
      return jsonRpcError(
        id,
        JSONRPC_ERROR.invalidParams,
        'resources/read names a resource in params.uri',
      );
    }

    const read = readAgentResource(uri, this.document, this.textOptions());
    if (!read.ok) return jsonRpcError(id, JSONRPC_ERROR.invalidParams, read.reason);

    return jsonRpcResult(id, { contents: [read.contents] });
  }

  /** What both text builders are called with. */
  private textOptions(): { readonly basePath: string; readonly agent: ResolvedAgentOptions } {
    return { basePath: this.basePath, agent: this.resolved };
  }

  /** The refusal both text addresses give while the host has them switched off. */
  private textFilesOff(): AgentSurfaceReply {
    return {
      status: 403,
      contentType: 'text/plain; charset=utf-8',
      body:
        'The machine readable index of this reference is switched off on this mount. It is on ' +
        'unless a host writes agent: { llmsTxt: false }, per SPEC 18.1, and this address exists ' +
        'either way so that off is tellable from no such address.\n',
    };
  }

  /**
   * One JSON-RPC response as a reply.
   *
   * ALWAYS 200 WHEN THE ENVELOPE WAS READ AT ALL, which is JSON-RPC's own arrangement: a method
   * that failed says so inside the envelope, and a transport status carrying the same news would
   * give a client two disagreeing answers about one call. The refusals above are the two cases
   * where there is no envelope to put an answer in.
   *
   * @param response - The response object
   * @returns The reply
   */
  private rpc(response: ReturnType<typeof jsonRpcResult>): AgentSurfaceReply {
    return {
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(response),
    };
  }
}
