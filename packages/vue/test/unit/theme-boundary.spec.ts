import { finalizeDocument } from '@openref/core';
import { defineComponent, h, type VNode } from 'vue';
import { describe, expect, it } from 'vitest';
import { createDocState, useDocument, useNode } from '../../src/index';
import { simpleDocument } from '../mocks/documents';
import { renderWithDocState } from '../mocks/render';

/**
 * The theme boundary, per SPEC 10.4 and the T031 amendment on the two open boundaries.
 *
 * A THEME IS SOMEBODY ELSE'S CODE, so `readonly` in a slot prop obliges it to nothing. What it
 * receives is the same document the other pages of the same reference render from, and a theme
 * that writes to it changes what the next page draws while the hash keeps describing the value
 * the write came after. The answer is in `finalizeDocument`, not in a comment: what carries a
 * hash is frozen.
 *
 * THE ASSERTION IS ABOUT THE NEXT PAGE AND NOT ABOUT THE THROW. A refusal that throws while the
 * value still changed would pass a test that only watched for an exception, so both cases
 * render a second page from the same document afterwards and compare it against the page that
 * document produced before any theme ran.
 */

/** A theme component that writes to what it was handed, which is the whole point of the case. */
const WritingTheme = defineComponent({
  name: 'WritingTheme',
  setup() {
    const { info, document } = useDocument();
    let refusal = '';

    try {
      (info.value as { title: string }).title = 'written by the theme';
    } catch (error) {
      refusal = error instanceof Error ? error.constructor.name : 'unknown';
    }

    try {
      (document.value.nodes as Map<string, never>).clear();
    } catch (error) {
      refusal += ` ${error instanceof Error ? error.constructor.name : 'unknown'}`;
    }

    return (): VNode => h('p', { class: 'oref-refusal' }, refusal.trim());
  },
});

/** A page that prints what the document says, so a write by the theme would be visible here. */
const ReadingPage = defineComponent({
  name: 'ReadingPage',
  setup() {
    const { info } = useDocument();
    const { node } = useNode();
    return (): VNode =>
      h('section', [
        h('h1', info.value.title),
        h('p', node.value?.id ?? 'no node'),
        h('p', node.value?.title ?? ''),
      ]);
  },
});

describe('a theme that writes to a slot prop', () => {
  it('should be refused by the value itself rather than by a type', async () => {
    // Given
    const document = finalizeDocument({ ...simpleDocument(), hash: '' });

    // When
    const html = await renderWithDocState(
      createDocState({ document, activeNodeId: 'get-orders' }),
      WritingTheme,
    );

    // Then
    expect(html).toContain('TypeError TypeError');
  });

  it('should leave the next page rendering exactly what it rendered before', async () => {
    // Given
    const document = finalizeDocument({ ...simpleDocument(), hash: '' });
    const before = await renderWithDocState(
      createDocState({ document, activeNodeId: 'get-orders' }),
      ReadingPage,
    );

    // When, the theme runs on one page of the reference
    await renderWithDocState(
      createDocState({ document, activeNodeId: 'get-orders' }),
      WritingTheme,
    );

    // Then, the next page of the same reference is unchanged
    const after = await renderWithDocState(
      createDocState({ document, activeNodeId: 'get-orders' }),
      ReadingPage,
    );
    expect(after).toBe(before);
  });

  it('should leave the hash describing the content it was taken over', async () => {
    // Given
    const document = finalizeDocument({ ...simpleDocument(), hash: '' });
    const hashBefore = document.hash;

    // When
    await renderWithDocState(
      createDocState({ document, activeNodeId: 'get-orders' }),
      WritingTheme,
    );

    // Then
    expect(document.hash).toBe(hashBefore);
    expect(document.info.title).not.toBe('written by the theme');
    expect(document.nodes.size).toBeGreaterThan(0);
  });
});
