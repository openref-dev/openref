/**
 * TX-ADOPT: the static half of a node page is adopted, not redrawn.
 *
 * Three seams, each the one that could drift silently: the walk the model builder owns, the
 * redaction the serializer owns, and the stub set the browser fills the registry with, pinned
 * against the server resolved list so the two cannot disagree without a red case.
 */

import { describe, expect, it } from 'vitest';
import { buildPageModel } from '../../src/page/domain/page-model';
import { serializePageModel } from '../../src/render/application/services/render.service';
import { createMarkdownRenderer } from '../../src/markdown/domain/markdown';
import { runtimeDocument, runtimeNodeId, smallDocument } from '../mocks/documents';
import type { PageKind, PageModel } from '@openref/vue';

async function modelFor(kind?: PageKind, nodeId?: string): Promise<PageModel> {
  const document = runtimeDocument();

  return buildPageModel(document, {
    ...(kind === undefined ? {} : { page: kind }),
    nodeId: nodeId ?? runtimeNodeId(document),
    markdown: await createMarkdownRenderer(),
  });
}

/** The client model as `readPageState` would produce it. */
function redacted(model: PageModel): PageModel {
  return JSON.parse(serializePageModel(model)) as PageModel;
}

describe('drawnOf, through buildPageModel', () => {
  it('should list the sections in draw order for an operation with facts', async () => {
    // Given a node with runtime facts, parameters and responses
    const model = await modelFor();

    // Then the walk is the composition's old conditions, in the order the page draws
    expect(model.node?.drawn).toEqual(['header', 'runtime', 'description', 'params', 'responses']);
  });

  it('should draw the security section only when there is no scale to carry it', async () => {
    // Given an operation that declares security, in a document with no runtime pass
    const document = smallDocument();
    const secured = [...document.nodes.entries()].find(
      ([, node]) => node.kind === 'operation' && node.security.length > 0,
    )?.[0];
    expect(secured).toBeDefined();
    const model = buildPageModel(document, {
      nodeId: secured ?? null,
      markdown: await createMarkdownRenderer(),
    });

    // Then security stands as its own section, per the TX-GUTTER rule
    expect(model.node?.drawn).toContain('security');
    expect(model.node?.drawn).not.toContain('runtime');
  });
});

describe('serializePageModel, the redaction of TX-ADOPT', () => {
  it('should keep the walk and empty what only server resolved positions read', async () => {
    // Given a node page model
    const client = redacted(await modelFor());

    // Then the client receives the shape and not the drawn models
    expect(client.node?.drawn).toEqual(['header', 'runtime', 'description', 'params', 'responses']);
    expect(client.node?.parameters).toEqual([]);
    expect(client.node?.responses).toEqual([]);
    expect(client.node?.security).toEqual([]);
    expect(client.node?.runtime).toBeNull();
    expect(client.node?.run).toBeNull();
    expect(client.node?.descriptionHtml).toBe('');
    expect(client.descriptionHtml).toBe('');
    expect(client.servers).toEqual([]);
  });

  it('should keep what the bench console reads and empty the rest', async () => {
    // Given a bench page model of the same operation
    const model = await modelFor('bench');
    const client = redacted(model);

    // Then the runner projection and the console's two fact columns survive
    expect(client.node?.run).not.toBeNull();
    expect(client.node?.responses.map((response) => response.statusCode)).toEqual(
      model.node?.responses.map((response) => response.statusCode),
    );
    expect(client.node?.parameters.map((parameter) => parameter.unread)).toEqual(
      model.node?.parameters.map((parameter) => parameter.unread),
    );

    // And the operation page's material does not
    expect(client.node?.runtime).toBeNull();
    expect(client.node?.parameters.every((parameter) => parameter.descriptionHtml === '')).toBe(
      true,
    );
    expect(client.node?.responses.every((response) => response.descriptionHtml === '')).toBe(true);
  });

  it('should keep the call samples whole, because the language tab redraws from them', async () => {
    // Given a node whose document wrote call samples
    const model = await modelFor();
    const sampled: PageModel = {
      ...model,
      node:
        model.node === null
          ? null
          : {
              ...model.node,
              codeSamples: [{ lang: 'shell', label: 'cURL', sourceHtml: '<pre>curl</pre>' }],
            },
    };

    // When
    const client = redacted(sampled);

    // Then the one live section of the article keeps its models
    expect(client.node?.codeSamples).toEqual([
      { lang: 'shell', label: 'cURL', sourceHtml: '<pre>curl</pre>' },
    ]);
  });
});

// The browser stub set is pinned against SERVER_RESOLVED_ROOTS in
// `test/integration/adopt-stubs.spec.ts`: the stubs live in `src/browser`, which the root
// typecheck program deliberately excludes because DOM types are scoped there, per T011.
