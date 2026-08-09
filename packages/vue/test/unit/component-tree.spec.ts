import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDocState } from '../../src/index';
import { mutuallyRecursiveDocument, simpleDocument } from '../mocks/documents';
import { ReferenceTree } from '../mocks/reference-tree';
import { renderWithDocState } from '../mocks/render';

/**
 * The M0 done-when of T008: a component tree renders an operation using only composables,
 * with zero direct store access.
 */

const TREE_SOURCE = join(import.meta.dirname, '..', 'mocks', 'reference-tree.ts');

describe('a reference built from composables alone', () => {
  it('should render an operation without touching the state directly', async () => {
    // Given
    const state = createDocState({ document: simpleDocument(), activeNodeId: 'get-orders' });

    // When
    const html = await renderWithDocState(state, ReferenceTree);

    // Then
    expect(html).toContain('Orders API 1.4.0');
    expect(html).toContain('List orders');
    expect(html).toContain('get /orders');
    expect(html).toContain('limit');
    expect(html).toContain('X-Trace');
    expect(html).toContain('200');
  });

  it('should reach the state through composables only, never through inject', () => {
    // Given, the constraint is structural: a theme that has to inject the store is a theme
    // the contract cannot protect. Reading the source is what makes the claim checkable.
    const source = readFileSync(TREE_SOURCE, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');

    // When
    const forbidden = ['useDocState', 'DOC_STATE_KEY', 'inject('].filter((token) =>
      source.includes(token),
    );

    // Then
    expect(forbidden).toEqual([]);
  });

  it('should mark the node the state has selected', async () => {
    // Given
    const state = createDocState({ document: simpleDocument(), activeNodeId: 'post-orders' });

    // When
    const html = await renderWithDocState(state, ReferenceTree);

    // Then
    expect(html).toContain('oref-active');
    expect(html).toContain('Create an order');
  });

  it('should render an operation nothing has selected without failing', async () => {
    // Given
    const state = createDocState({ document: simpleDocument() });

    // When
    const html = await renderWithDocState(state, ReferenceTree);

    // Then
    expect(html).toContain('Orders API 1.4.0');
    expect(html).not.toContain('oref-active');
  });

  it('should carry no inline style attribute and no inline script', async () => {
    // Given, strict CSP is a declared property of this project, per STANDARDS 10.
    const state = createDocState({ document: simpleDocument(), activeNodeId: 'get-orders' });

    // When
    const html = await renderWithDocState(state, ReferenceTree);

    // Then
    expect(html).not.toMatch(/\sstyle=/);
    expect(html).not.toContain('<script');
  });

  it('should terminate while rendering a schema tree that cycles through named schemas', async () => {
    // Given, the tree expands every position it is handed. Without the expander's own path
    // tracking this would not return, and no marker in the IR would stop it.
    const document = mutuallyRecursiveDocument();
    const state = createDocState({ document });

    // When
    const html = await renderWithDocState(state, ReferenceTree);

    // Then
    expect(html).toContain('Pair');
  });
});
