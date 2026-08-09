import { createSSRApp, defineComponent, h } from 'vue';
import type { Component } from 'vue';
import { renderToString } from 'vue/server-renderer';
import type { DocState } from '../../src/index';
import { provideDocState } from '../../src/index';

/**
 * A minimal harness for exercising composables inside a real component instance.
 *
 * Server side rendering rather than a DOM: the headless layer touches no DOM at all, so
 * mounting one would only add a dependency and hide a violation if one ever crept in.
 *
 * The state is provided by a parent and consumed by a child, because Vue resolves `inject`
 * from the parent chain and a component cannot inject what it provided itself.
 */

/**
 * Runs a composable inside a child of a component that provides the state.
 *
 * @param state - State to provide
 * @param body - Called in the child's setup, where the composables are available
 * @returns Whatever `body` returned
 */
export async function withDocState<T>(state: DocState, body: () => T): Promise<T> {
  let captured: { value: T } | undefined;

  const child = defineComponent({
    name: 'Child',
    setup() {
      captured = { value: body() };
      return () => h('div');
    },
  });

  const parent = defineComponent({
    name: 'Parent',
    setup() {
      provideDocState(state);
      return () => h(child);
    },
  });

  await renderToString(createSSRApp(parent));

  if (captured === undefined) throw new Error('the child setup never ran');
  return captured.value;
}

/**
 * Renders a component tree that provides the state, and returns the markup.
 *
 * @param state - State to provide
 * @param child - The component under test, mounted below the provider
 * @returns The rendered markup
 */
export async function renderWithDocState(state: DocState, child: Component): Promise<string> {
  const parent = defineComponent({
    name: 'Provider',
    setup() {
      provideDocState(state);
      return () => h(child);
    },
  });

  return renderToString(createSSRApp(parent));
}
