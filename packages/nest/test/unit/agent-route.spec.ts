import { describe, expect, it } from 'vitest';
import {
  AUDIENCE_EXTENSION,
  INTERNAL_AUDIENCE,
  plainSummary as agentSummary,
  SUMMARY_LIMIT,
} from '@openref/agent';
import { plainSummary as staticSummary } from '@openref/static';
import { assertAgentOptions } from '../../src/agent/domain/agent-mount';
import { OPENREF_EXTENSIONS } from '../../src/api/decorators/metadata';
import { replyText } from '../../src/http/domain/reply';
import { ReferenceService } from '../../src/reference/application/services/reference.service';
import {
  LLMS_FULL_SEGMENT,
  LLMS_SEGMENT,
  MCP_SEGMENT,
  referenceRoutes,
} from '../../src/reference/domain/routes';
import { assetPlan, specification } from '../mocks/fixtures';
import type { AgentOptions } from '@openref/agent';
import type { ReferenceRequest } from '../../src/http/application/ports/reference-http.port';

/**
 * A service over the fixture document, with whatever the host wrote for the agent surface.
 *
 * @param agent - The two switches, or nothing
 * @returns The service
 */
function service(agent?: AgentOptions): ReferenceService {
  return new ReferenceService({
    document: specification(),
    basePath: '/docs',
    assets: assetPlan(),
    highlight: false,
    ...(agent === undefined ? {} : { agent }),
  });
}

/** A request with an optional body, for the one agent route that takes one. */
function request(body?: string): ReferenceRequest {
  return { params: {}, headers: {}, ...(body === undefined ? {} : { body }) };
}

describe('the agent routes of SPEC 13.3', () => {
  it('should be registered on every mount, before the route that would swallow them', () => {
    // Given, `llms.txt` under a mount is one path segment, exactly as a node id is: registered
    // after the node page route it would be answered by it and never reached
    const routes = referenceRoutes('/docs');

    // When
    const nodeAt = routes.findIndex((route) => route.id === 'node');
    const agentAt = routes
      .filter((route) => ['llms', 'llms-full', 'mcp'].includes(route.id))
      .map((route) => routes.indexOf(route));

    // Then, four registrations for three ids: `mcp` is registered on POST and on GET
    expect(agentAt).toHaveLength(4);
    expect(agentAt.every((index) => index < nodeAt)).toBe(true);
    expect(routes.find((route) => route.id === 'llms')?.pattern).toBe(`/docs/${LLMS_SEGMENT}`);
    expect(routes.find((route) => route.id === 'llms-full')?.pattern).toBe(
      `/docs/${LLMS_FULL_SEGMENT}`,
    );
    expect(routes.find((route) => route.id === 'mcp')?.pattern).toBe(`/docs/${MCP_SEGMENT}`);
  });

  it('should serve the index and the full text on a mount that configured nothing', async () => {
    // Given, SPEC 18 keeps the two text files on because they are cheap over a good IR
    const reference = service();

    // When
    const index = await reference.handle('llms', request());
    const full = await reference.handle('llms-full', request());

    // Then
    expect(index.status).toBe(200);
    expect(index.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(index.headers['cache-control']).toBe('no-store');
    expect(replyText(index)).toContain('# Orders');
    expect(replyText(full)).toContain('### GET /orders/{id}');
  });

  it('should refuse the MCP endpoint on a default mount rather than answering an empty list', () => {
    // Given, an empty tool list would be indistinguishable from a switched off endpoint, which
    // is the shape of failure SPEC 18 keeps this address off by default to avoid
    const reference = service();

    // When, Then
    return reference
      .handle('mcp', request(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })))
      .then((reply) => {
        expect(reply.status).toBe(403);
        expect(replyText(reply)).toContain('agent: { mcp: true }');
      });
  });

  it('should answer the MCP endpoint once a host switched it on', async () => {
    // Given
    const reference = service({ mcp: true });

    // When
    const reply = await reference.handle(
      'mcp',
      request(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })),
    );

    // Then, the tool names the node id rather than the operation id, because SPEC 5.4 guarantees
    // one of the two is unique, and its description links the address under this mount rather
    // than under the root
    expect(reply.status).toBe(200);
    expect(replyText(reply)).toContain('"name":"get-orders-id"');
    expect(replyText(reply)).toContain('Reference page: /docs/get-orders-id');
  });

  it('should serve the two text files from the document the mount settled on', async () => {
    // Given, the surface is built after the document, so what it serves is what the pages show
    const reference = service();

    // When
    const index = await reference.handle('llms', request());

    // Then
    expect(replyText(index)).toContain(`Document hash: ${reference.document.hash}`);
  });

  it('should hand the surface back so a host can read what this mount offers', () => {
    // Given
    const reference = service({ llmsTxt: false, mcp: false });

    // When
    const options = reference.agent.options;

    // Then
    expect(options).toEqual({ llmsTxt: false, mcp: false });
  });
});

describe('the audience key the MCP filter reads', () => {
  it('should be the one `@ApiAudience` writes, which is not the package that reads it', () => {
    // Given, `@openref/agent` may not reach this package, per STANDARDS 3.5, so it spells the
    // extension key itself. Two spellings of one key is a filter that matches nothing, and on
    // this question matching nothing means exposed, so the agreement is asserted rather than
    // assumed. This is the only place both constants are visible at once.
    const written = OPENREF_EXTENSIONS.audience;

    // When
    const read = AUDIENCE_EXTENSION;

    // Then
    expect(read).toBe(written);
    expect(INTERNAL_AUDIENCE).toBe('internal');
  });
});

describe('the two plainSummary spellings this repository carries', () => {
  /**
   * Inputs chosen to reach every construct either function reduces, and one past the limit.
   *
   * THE LONG ONE IS THE CASE THAT WAS RED. The blind review of `T058` measured 202 characters
   * against 249 on a 249 character input, because the two limits were 200 and 300 while a comment
   * claimed they agreed. It is first in the list so a failure names it.
   */
  const INPUTS: readonly string[] = [
    `${'word '.repeat(60)}end`,
    'x'.repeat(400),
    '# Heading\n\nBody with `code` and [a link](https://example.test) and ![alt](a.png).',
    '```ts\nconst a = 1;\n```\n\nAfter the fence.',
    '*emphasis* _under_ > quoted',
    '',
    'Short and plain.',
  ];

  it('should reduce and cut identically, driven through both at once', () => {
    // Given, per SPEC 18.1: the two cannot be shared without changing a package T058 does not
    // name, so the agreement is a case rather than a sentence. This file is the one place both
    // are visible, exactly as it is for the audience extension key above.
    const cut = INPUTS.filter((input) => input.length > SUMMARY_LIMIT);
    expect(cut.length).toBeGreaterThan(0);

    // When
    const mine = INPUTS.map((input) => agentSummary(input));
    const theirs = INPUTS.map((input) => staticSummary(input));

    // Then, with the presence half first: at least one input really is longer than the limit, so
    // the comparison exercises the cut rather than only the reductions
    expect(mine).toEqual(theirs);
  });

  it('should cut at the same length, so one document is not described two ways', () => {
    // Given the exact shape the review measured: one input just under the wider limit
    const written = 'a'.repeat(249);

    // When
    const mine = agentSummary(written);
    const theirs = staticSummary(written);

    // Then
    expect(mine.length).toBe(theirs.length);
    expect(mine.length).toBe(249);
  });
});

describe('assertAgentOptions', () => {
  it('should refuse an MCP endpoint that no guard stands in front of', () => {
    // Given, SPEC 18 makes authentication mandatory when MCP is on
    const act = (): void => {
      assertAgentOptions('the reference', { agent: { mcp: true } });
    };

    // Then
    expect(act).toThrow(/supplies no guard/);
  });

  it('should refuse an MCP endpoint whose guard list is empty', () => {
    // Given, an empty list reads as guarded and guards nothing, which is the same reading
    // `admission.service.ts` already refuses
    const act = (): void => {
      assertAgentOptions('the reference', { agent: { mcp: true }, guard: [] });
    };

    // Then
    expect(act).toThrow(/supplies no guard/);
  });

  it('should accept an MCP endpoint behind one guard or several', () => {
    // Given
    const one = { canActivate: (): boolean => true };

    // When, Then
    expect(() => {
      assertAgentOptions('the reference', { agent: { mcp: true }, guard: one });
    }).not.toThrow();
    expect(() => {
      assertAgentOptions('the reference', { agent: { mcp: true }, guard: [one, one] });
    }).not.toThrow();
  });

  it('should say nothing about a mount whose MCP endpoint is off', () => {
    // Given, the two text files carry no credential and no live data, so they need no guard
    const act = (): void => {
      assertAgentOptions('the reference', { agent: { llmsTxt: true } });
    };

    // Then
    expect(act).not.toThrow();
  });
});
