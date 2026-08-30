import { describe, expect, it } from 'vitest';
import { DOCTOR_REPORT_VERSION, readDoctorReport } from '@openref/core';
import {
  AgentSurfaceService,
  DEFAULT_AGENT_LLMS_TXT,
  DEFAULT_AGENT_MCP,
  HEALTH_RESOURCE_URI,
  LLMS_FULL_RESOURCE_URI,
  LLMS_RESOURCE_URI,
  MCP_PROTOCOL_VERSION,
  type AgentOptions,
  type AgentSurfaceReply,
} from '../../src/index';
import { channelDocument, orderDocument } from '../mocks/documents';

/** One surface over the order document, with whatever the host configured. */
function surface(agent?: AgentOptions): AgentSurfaceService {
  const document = orderDocument();

  return new AgentSurfaceService({
    document,
    basePath: '/docs',
    ...(agent === undefined ? {} : { agent }),
  });
}

/** One JSON-RPC call against a surface. */
function call(
  service: AgentSurfaceService,
  method: string,
  params: Record<string, unknown> = {},
  id: number | string = 1,
): AgentSurfaceReply {
  return service.mcp(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
}

/** The `result` member of an answered call. */
function resultOf(reply: AgentSurfaceReply): Record<string, unknown> {
  const parsed = JSON.parse(reply.body) as { result?: Record<string, unknown> };
  if (parsed.result === undefined) throw new Error(`no result in ${reply.body}`);

  return parsed.result;
}

describe('the defaults of SPEC 18.1', () => {
  it('should serve the two text files and refuse MCP on a mount that configured nothing', () => {
    // Given a mount that says nothing about the agent surface at all
    const service = surface();

    // When
    const index = service.llmsIndex();
    const mcp = call(service, 'tools/list');

    // Then, per SPEC 18: `llms.txt` is cheap over a good IR and stays on, and MCP is a
    // capability rather than a reason to install the package, so it is off
    expect(DEFAULT_AGENT_LLMS_TXT).toBe(true);
    expect(DEFAULT_AGENT_MCP).toBe(false);
    expect(service.options).toEqual({ llmsTxt: true, mcp: false });
    expect(index.status).toBe(200);
    expect(mcp.status).toBe(403);
    expect(mcp.body).toContain('agent: { mcp: true }');
  });

  it('should refuse a switched off text file with words rather than with a 404', () => {
    // Given, per the `_proxy` precedent of SPEC 13.3: a route that exists only when a feature is
    // on makes "off" and "no such address" the same answer from outside
    const service = surface({ llmsTxt: false });

    // When
    const index = service.llmsIndex();
    const full = service.llmsFull();

    // Then
    expect([index.status, full.status]).toEqual([403, 403]);
    expect(index.body).toContain('agent: { llmsTxt: false }');
  });
});

describe('the MCP endpoint when it is switched on', () => {
  it('should answer initialize with the protocol version and the two capabilities it has', () => {
    // Given
    const service = surface({ mcp: true });

    // When
    const result = resultOf(call(service, 'initialize'));

    // Then, declaring a capability this endpoint does not implement would have a client call a
    // method that answers methodNotFound, which reads to it as a broken server
    expect(result.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
    expect(result.capabilities).toEqual({ tools: {}, resources: {} });
  });

  it('should name remediation as a supported use in the message every client reads first', () => {
    // Given, per `ai-docs/REMEDIATION.md` section 6: remediation is a supported use of this
    // surface, and a supported use only a document mentions is one a caller learns out of band
    const service = surface({ mcp: true });

    // When
    const instructions = String(resultOf(call(service, 'initialize')).instructions);

    // Then
    expect(instructions).toContain('Remediation is a supported use');
    expect(instructions).toContain(HEALTH_RESOURCE_URI);
    expect(instructions).toContain('refuse a version you do not read');
    expect(instructions).toContain('sends no request to the API it documents');
  });

  it('should answer a notification with no body at all, per JSON-RPC', () => {
    // Given the message every MCP client sends after the handshake
    const service = surface({ mcp: true });

    // When
    const reply = service.mcp(
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    );

    // Then
    expect(reply.status).toBe(202);
    expect(reply.body).toBe('');
  });

  it('should refuse a method it does not implement and name the ones it does', () => {
    // Given
    const service = surface({ mcp: true });

    // When
    const parsed = JSON.parse(call(service, 'prompts/list').body) as {
      error?: { code: number; message: string };
    };

    // Then
    expect(parsed.error?.code).toBe(-32601);
    expect(parsed.error?.message).toContain('tools/list');
  });

  it('should answer with 200 and an error envelope rather than an HTTP status', () => {
    // Given, JSON-RPC puts a method failure inside the envelope, and a transport status
    // carrying the same news would give a client two disagreeing answers about one call
    const service = surface({ mcp: true });

    // When
    const reply = call(service, 'resources/read', { uri: 'openref://nothing' });

    // Then
    expect(reply.status).toBe(200);
    expect(JSON.parse(reply.body)).toHaveProperty('error');
  });

  it('should say what it takes when a GET reaches it with no body', () => {
    // Given, the GET registration exists so this address is not answered by the node page route
    const service = surface({ mcp: true });

    // When
    const reply = service.mcp(undefined);

    // Then
    expect(reply.status).toBe(400);
    expect(reply.body).toContain('JSON-RPC 2.0 request in the body of a POST');
  });
});

describe('what the MCP surface never exposes', () => {
  it('should carry no tool for a node marked audience internal', () => {
    // Given a document carrying one, asserted present first: an absent tool and an absent node
    // look the same from a tool list
    const document = orderDocument();
    expect(document.nodes.has('post-admin-impersonate')).toBe(true);
    const service = surface({ mcp: true });

    // When
    const tools = resultOf(call(service, 'tools/list')).tools as { name: string }[];

    // Then
    expect(tools.map((tool) => tool.name)).toEqual(['get-orders', 'post-orders']);
  });

  it('should answer a call on an internal node exactly as it answers an unknown name', () => {
    // Given, a different message would tell a caller that an operation it may not see exists
    const service = surface({ mcp: true });

    // When
    const withheld = resultOf(call(service, 'tools/call', { name: 'post-admin-impersonate' }));
    const absent = resultOf(call(service, 'tools/call', { name: 'no-such-operation' }));

    // Then both are the same shape, and neither says the node exists
    expect(withheld.isError).toBe(true);
    expect(absent.isError).toBe(true);
    expect(JSON.stringify(withheld)).toContain('no tool named');
    expect(JSON.stringify(absent)).toContain('no tool named');
  });

  it('should carry no internal node in either text file, on either surface', () => {
    // Given a document with one internal operation and two public ones, both asserted present:
    // a file that withholds everything and a file that reached no node look the same
    const document = orderDocument();
    expect(document.nodes.has('post-admin-impersonate')).toBe(true);
    expect(document.nodes.has('post-orders')).toBe(true);
    const service = surface({ mcp: true });

    // When, the same two files read the two ways a caller can reach them
    const overHttp = [service.llmsIndex().body, service.llmsFull().body];
    const overMcp = [LLMS_RESOURCE_URI, LLMS_FULL_RESOURCE_URI].map((uri) => {
      const contents = resultOf(call(service, 'resources/read', { uri })).contents as {
        text: string;
      }[];
      return contents[0]?.text ?? '';
    });

    // Then, the public sibling is in all four and the internal node is in none of them, by the
    // three spellings it could appear under: its node id in a link, its path in a heading, and
    // its summary as a title. Found by the second blind review of `T058`, which read
    // `POST /admin/impersonate` back through `resources/read openref://llms-full.txt` while
    // `tools/list` on the same address withheld it.
    //
    // THE FOUR ARE NAMED AND ASSERTED AS A SET RATHER THAN IN A LOOP, so that unhooking the
    // filter reddens with both surfaces in the message instead of stopping at the first one.
    const named: readonly (readonly [string, string])[] = [
      ['http llms.txt', overHttp[0] ?? ''],
      ['http llms-full.txt', overHttp[1] ?? ''],
      ['mcp llms.txt', overMcp[0] ?? ''],
      ['mcp llms-full.txt', overMcp[1] ?? ''],
    ];
    const leaks = ['post-admin-impersonate', '/admin/impersonate', 'Act as another account'];

    expect(
      named.filter(([, text]) => !text.includes('post-orders')).map(([label]) => label),
    ).toEqual([]);
    expect(
      named
        .filter(([, text]) => leaks.some((spelling) => text.includes(spelling)))
        .map(([label]) => label),
    ).toEqual([]);
  });

  it('should serve the same bytes at the HTTP address and as the MCP resource', () => {
    // Given, per SPEC 18.1: filtering on the MCP path alone would give one document two
    // spellings, so the filter is in the file and both routes call the same builder
    const service = surface({ mcp: true });

    // When
    const pairs: readonly [string, string][] = [
      [service.llmsIndex().body, LLMS_RESOURCE_URI],
      [service.llmsFull().body, LLMS_FULL_RESOURCE_URI],
    ];

    // Then
    for (const [served, uri] of pairs) {
      const contents = resultOf(call(service, 'resources/read', { uri })).contents as {
        text: string;
      }[];
      expect(contents[0]?.text).toBe(served);
    }
  });

  it('should refuse the two resources by name while the host has the files off', () => {
    // Given, the other half of the same asymmetry: off has to be off on both surfaces
    const service = surface({ llmsTxt: false, mcp: true });

    // When
    const listed = (resultOf(call(service, 'resources/list')).resources as { uri: string }[]).map(
      (resource) => resource.uri,
    );
    const refusal = JSON.parse(
      call(service, 'resources/read', { uri: LLMS_RESOURCE_URI }).body,
    ) as { error?: { message: string } };

    // Then
    expect(listed).toEqual([HEALTH_RESOURCE_URI]);
    expect(refusal.error?.message).toContain('agent: { llmsTxt: false }');
    expect(service.llmsIndex().status).toBe(403);
  });

  it('should expose no channel as a tool while still describing it in the text files', () => {
    // Given an events document, whose channels SPEC 18 keeps out of the tool list
    const document = channelDocument();
    expect([...document.nodes.values()].every((node) => node.kind === 'channel')).toBe(true);
    const service = new AgentSurfaceService({ document, basePath: '/docs', agent: { mcp: true } });

    // When
    const tools = resultOf(call(service, 'tools/list')).tools as unknown[];
    const full = service.llmsFull();

    // Then, not exposed as a tool and not hidden either
    expect(tools).toEqual([]);
    expect(full.body).toContain('orders.created');
  });
});

describe('the tools of SPEC 18', () => {
  it('should mark a mutating operation as requiring confirmation and a safe one as not', () => {
    // Given
    const service = surface({ mcp: true });

    // When
    const tools = resultOf(call(service, 'tools/list')).tools as {
      name: string;
      mutating: boolean;
      requiresConfirmation: boolean;
      description: string;
    }[];
    const read = tools.find((tool) => tool.name === 'get-orders');
    const write = tools.find((tool) => tool.name === 'post-orders');

    // Then
    expect(read?.mutating).toBe(false);
    expect(read?.requiresConfirmation).toBe(false);
    expect(write?.mutating).toBe(true);
    expect(write?.requiresConfirmation).toBe(true);
    expect(write?.description).toContain('Confirm with the person you are acting for');
  });

  it('should describe itself truthfully to the client as a tool that only reads', () => {
    // Given, per SPEC 18.1: a tool claiming to be destructive while reading documentation would
    // be a lie a client renders as a warning, so the annotations are about the tool and the
    // marking about the operation
    const service = surface({ mcp: true });

    // When
    const tools = resultOf(call(service, 'tools/list')).tools as {
      name: string;
      annotations: Record<string, unknown>;
    }[];
    const write = tools.find((tool) => tool.name === 'post-orders');

    // Then
    expect(write?.annotations).toEqual({
      title: 'Create an order',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    });
  });

  it('should return the operation contract and say that it sent nothing', () => {
    // Given
    const service = surface({ mcp: true });

    // When
    const result = resultOf(call(service, 'tools/call', { name: 'post-orders' }));
    const text = JSON.stringify(result);

    // Then
    expect(result.isError).toBe(false);
    expect(text).toContain('POST /orders');
    expect(text).toContain('Security: bearer (orders:write)');
    expect(text).toContain('sends no request anywhere');
  });

  it('should refuse a call that names no tool at all', () => {
    // Given
    const service = surface({ mcp: true });

    // When
    const parsed = JSON.parse(call(service, 'tools/call').body) as {
      error?: { code: number };
    };

    // Then
    expect(parsed.error?.code).toBe(-32602);
  });
});

describe('the resources of REMEDIATION section 6', () => {
  it('should offer the two text files and the versioned health report', () => {
    // Given
    const service = surface({ mcp: true });

    // When
    const resources = resultOf(call(service, 'resources/list')).resources as { uri: string }[];

    // Then
    expect(resources.map((resource) => resource.uri)).toEqual([
      LLMS_RESOURCE_URI,
      LLMS_FULL_RESOURCE_URI,
      HEALTH_RESOURCE_URI,
    ]);
  });

  it('should expose the report version rather than implying it', () => {
    // Given, per REMEDIATION section 6: a consumer that pins or caches has to be able to refuse
    // a shape it does not read, and an empty report that means "I could not read this" is the
    // worst output this tool can produce
    const service = surface({ mcp: true });

    // When
    const contents = resultOf(call(service, 'resources/read', { uri: HEALTH_RESOURCE_URI }))
      .contents as { text: string; mimeType: string }[];
    const text = contents[0]?.text ?? '';

    // Then the payload passes `core`'s own reader, which is what a consumer would use
    const read = readDoctorReport(text);
    expect(read.ok).toBe(true);
    expect(read.ok ? read.report.version : 0).toBe(DOCTOR_REPORT_VERSION);
  });

  it('should read the index resource as the same bytes the address serves', () => {
    // Given, two spellings of one file is the drift this repository keeps finding
    const service = surface({ mcp: true });

    // When
    const contents = resultOf(call(service, 'resources/read', { uri: LLMS_RESOURCE_URI }))
      .contents as { text: string }[];

    // Then
    expect(contents[0]?.text).toBe(service.llmsIndex().body);
  });
});
