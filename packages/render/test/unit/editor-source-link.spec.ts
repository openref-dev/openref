import { describe, expect, it } from 'vitest';
import { hashDocument, type IRDocument, type IRNode, type IRSourceLocation } from '@openref/core';
import { createMarkdownRenderer } from '../../src/markdown/domain/markdown';
import { renderPage } from '../../src/render/application/services/render.service';
import { runtimeDocument, runtimeNodeId } from '../mocks/documents';

/**
 * The editor form of SPEC 6.3 on the served page, and the absolute path's absence from it.
 *
 * WHAT THIS FILE IS ABOUT IS BYTES AND NOT A MODEL. `T018-R1`'s second done-when is that a page
 * rendered with no opt in carries no absolute path anywhere in what it serves, and the model is
 * one of two places a path could reach a reader from: the markup carries the `href`, and the
 * state block carries the model the browser adopts. Both are measured here, joined, because a
 * claim about a page that reads only half of it is the shape of claim SPEC 0 collects.
 *
 * A PROOF OF ABSENCE ASSERTS PRESENCE FIRST. The first case shows the same page, the same
 * template and the same handler producing the editor link, so the second case's silence is the
 * opt in doing its work rather than the fixture never having had a path to leak.
 */

const markdown = await createMarkdownRenderer();

/** The editor template a host running the reference on their own machine configures. */
const VSCODE = 'vscode://file/{absolutePath}:{line}:{column}';

/** Where the fixture's handler is on the machine that built the document. */
const MACHINE_PATH = '/home/dana/work/openref/src/orders.controller.ts';

/**
 * The runtime fixture with one source location and one template substituted in.
 *
 * @param template - What the host configured as `sourceLink`
 * @param source - The location as the collector produced it
 * @returns The document, with its hash retaken over the change
 */
function documentWith(template: string, source: IRSourceLocation): IRDocument {
  const base = runtimeDocument();
  const factsOn = runtimeNodeId(base);
  const nodes = new Map<string, IRNode>();

  for (const [id, node] of base.nodes) {
    const replace = id === factsOn && node.kind === 'operation' && node.runtime !== undefined;
    nodes.set(id, replace ? { ...node, runtime: { ...node.runtime, source } } : node);
  }

  const document: IRDocument = {
    ...base,
    nodes,
    runtime: { ...(base.runtime ?? { collectors: [] }), sourceLinkTemplate: template },
  };

  return { ...document, hash: hashDocument(document) };
}

/**
 * Everything the page serves for one node, markup and state block together.
 *
 * @param document - The document to render
 * @returns The served bytes of the operation page
 */
async function servedBytes(document: IRDocument): Promise<string> {
  const { appHtml, stateJson } = await renderPage(document, {
    nodeId: runtimeNodeId(document),
    markdown,
  });

  return `${appHtml}\n${stateJson}`;
}

describe('the editor source link on a served page', () => {
  it('should carry the editor link when the host opted in to the absolute path', async () => {
    // Given a document built with `sourceCollector({ absolutePath: true })` and the editor
    // template, which is the reference read on the machine that built it
    const document = documentWith(VSCODE, {
      controller: 'OrdersController',
      handler: 'findAll',
      file: 'src/orders.controller.ts',
      line: 42,
      absolutePath: MACHINE_PATH,
      column: 7,
    });

    // When
    const bytes = await servedBytes(document);

    // Then the reader's editor is what the link opens, at the line and the column
    expect(bytes).toContain('vscode://file/home/dana/work/openref/src/orders.controller.ts:42:7');
    expect(bytes).toContain('class="oref-source-link"');
  });

  it('should carry no absolute path at all when the host did not opt in', async () => {
    // Given the same page, the same template and the same handler, built the default way: the
    // collector had the machine path in hand and left it out of the document
    const document = documentWith(VSCODE, {
      controller: 'OrdersController',
      handler: 'findAll',
      file: 'src/orders.controller.ts',
      line: 42,
    });

    // When
    const bytes = await servedBytes(document);

    // Then nothing of the build machine is in what the page serves, not in the markup and not in
    // the state block the browser adopts
    expect(bytes).not.toContain(MACHINE_PATH);
    expect(bytes).not.toContain('/home/dana');
    expect(bytes).not.toContain('vscode://');

    // And the row says why there is no link, naming the option, rather than drawing a dead one
    expect(bytes).toContain('class="oref-runtime-note"');
    expect(bytes).toContain('sourceCollector({ absolutePath: true })');
  });

  it('should still expand the forge form, which is what a page served to a team carries', async () => {
    // Given the default template and the default collector, which is the case every other test in
    // this package renders
    const document = documentWith('https://github.com/org/repo/blob/abc123/{file}#L{line}', {
      controller: 'OrdersController',
      handler: 'findAll',
      file: 'src/orders.controller.ts',
      line: 42,
    });

    // When
    const bytes = await servedBytes(document);

    // Then
    expect(bytes).toContain('https://github.com/org/repo/blob/abc123/src/orders.controller.ts#L42');
  });
});
