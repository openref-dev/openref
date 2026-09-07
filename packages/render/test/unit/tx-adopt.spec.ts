/**
 * TX-ADOPT: the static half of a node page is adopted, not redrawn.
 *
 * Three seams, each the one that could drift silently: the walk the model builder owns, the
 * redaction the serializer owns, and the stub set the browser fills the registry with, pinned
 * against the server resolved list so the two cannot disagree without a red case.
 */

import { describe, expect, it } from 'vitest';
import { finalizeDocument } from '@openref/core';
import { buildPageModel } from '../../src/page/domain/page-model';
import { serializePageModel } from '../../src/render/application/services/render.service';
import { createMarkdownRenderer } from '../../src/markdown/domain/markdown';
import { eventsDocument, runtimeDocument, runtimeNodeId, smallDocument } from '../mocks/documents';
import type { IRDocument, IROperation } from '@openref/core';
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

/**
 * The small document with one operation given the sample facts a caller's transform would write.
 *
 * BUILT HERE RATHER THAN TAKEN FROM `withGeneratedSamples`, because `@openref/render` may not see
 * `@openref/samples` and the dependency linter says so. What is copied in is the shape of that
 * transform's output and nothing about how it decides the shape.
 *
 * @param facts - The two sample lists a page can carry without carrying a sample
 * @returns The document and the node id the facts were written onto
 */
function sampleFactsDocument(
  facts: Pick<IROperation, 'codeSamplesElsewhere' | 'codeSamplesRefused'>,
): { readonly document: IRDocument; readonly nodeId: string } {
  const document = smallDocument();
  const nodeId = runtimeNodeId(document);
  const node = document.nodes.get(nodeId);
  expect(node?.kind, 'the fixture no longer has the operation these facts go on').toBe('operation');

  const nodes = new Map(document.nodes);
  nodes.set(nodeId, { ...(node as IROperation), ...facts });

  return { document: finalizeDocument({ ...document, nodes, hash: '' }), nodeId };
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
  });

  it('should mount the runtime position on an operation nothing measured, per SPEC 6.3', async () => {
    // Given an operation in a document no collector ran over
    const document = smallDocument();
    const operation = [...document.nodes.entries()].find(
      ([, node]) => node.kind === 'operation' && node.runtime === undefined,
    )?.[0];
    expect(operation, 'the fixture no longer has an unmeasured operation').toBeDefined();

    // When
    const model = buildPageModel(document, {
      nodeId: operation ?? null,
      markdown: await createMarkdownRenderer(),
    });

    // Then the position is mounted anyway, because what fills it is the sentence saying nothing
    // measured this. It used to be absent, which made an uninstrumented page identical to one
    // whose collectors all agreed with the specification.
    expect(model.node?.drawn).toContain('runtime');
    expect(model.node?.runtime).toBeNull();
  });

  it('should mount no runtime position on a channel, which no collector can reach', async () => {
    // Given a channel, per SPEC 6.3: every collector is HTTP until M5 builds the event ones
    const document = eventsDocument();
    const channel = [...document.nodes.entries()].find(([, node]) => node.kind === 'channel')?.[0];
    expect(channel, 'the fixture no longer has a channel').toBeDefined();

    // When
    const model = buildPageModel(document, {
      nodeId: channel ?? null,
      markdown: await createMarkdownRenderer(),
    });

    // Then nothing is drawn, because a measurement that cannot be taken and a measurement
    // nobody took are different statements and only the second one has a sentence.
    expect(model.node?.drawn).not.toContain('runtime');
  });

  it('should mount the samples section for a node that only names languages, per SPEC 18', async () => {
    // Given an operation with no sample of its own and two languages named beside it, which is what
    // `withGeneratedSamples` writes when a caller passes a `languages` set that leaves both of them
    // off the page. NO SHIPPED SURFACE PASSES ONE, measured 2026-09-03: `ReferenceService` and both
    // `@openref/static` entry points call the transform with two arguments and take the default
    // twelve. So this is a guard on a state the model must draw correctly rather than a reproduction
    // of one a reader can reach today, and the case below it is the one that reaches every surface.
    const { document, nodeId } = sampleFactsDocument({
      codeSamplesElsewhere: [
        { lang: 'typescript', label: 'TypeScript' },
        { lang: 'swift', label: 'Swift' },
      ],
    });

    // When
    const model = buildPageModel(document, { nodeId, markdown: await createMarkdownRenderer() });

    // Then, the subject first: there is nothing to draw and two languages to name.
    expect(model.node?.codeSamples).toEqual([]);
    expect(model.node?.codeSamplesElsewhere.map((language) => language.lang)).toEqual([
      'typescript',
      'swift',
    ]);

    // And the section mounts on there being something to state rather than on the other list.
    expect(model.node?.drawn).toContain('samples');
  });

  it('should mount the samples section for a node that only carries a refusal, per SPEC 18', async () => {
    // Given an operation every language refused, which is what a plan the runner will not send
    // produces: no tab, and a reason that used to reach the caller alone.
    const { document, nodeId } = sampleFactsDocument({
      codeSamplesRefused: [
        {
          reason: 'the runner refuses to send this request at all',
          languages: [{ lang: 'shell', label: 'cURL' }],
        },
      ],
    });

    // When
    const model = buildPageModel(document, { nodeId, markdown: await createMarkdownRenderer() });

    // Then, the subject first
    expect(model.node?.codeSamples).toEqual([]);
    expect(model.node?.codeSamplesRefused).toHaveLength(1);

    // And a vanished tab is told apart from a language the page never had
    expect(model.node?.drawn).toContain('samples');
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
