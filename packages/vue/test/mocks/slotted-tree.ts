import { defineComponent, h } from 'vue';
import type { Component, VNode } from 'vue';
import { useDocument, useOperation, useSlot } from '../../src/index';

/**
 * A tree whose regions all come out of the slot registry.
 *
 * It exists so that "overriding one slot leaves the rest byte identical" can be measured
 * rather than asserted in prose. Each region is wrapped in an element carrying its slot name,
 * so a test can compare the regions one by one.
 */

const DefaultHeader = defineComponent({
  name: 'DefaultHeader',
  setup() {
    const { operation } = useOperation();
    return (): VNode =>
      h('h2', { class: 'oref-operation-title' }, operation.value?.title ?? 'no operation');
  },
});

const DefaultParameters = defineComponent({
  name: 'DefaultParameters',
  setup() {
    const { parameters } = useOperation();
    return (): VNode =>
      h(
        'ul',
        { class: 'oref-parameters' },
        [...parameters.value.values()]
          .flat()
          .map((parameter) => h('li', { key: parameter.name }, parameter.name)),
      );
  },
});

const DefaultFooter = defineComponent({
  name: 'DefaultFooter',
  setup() {
    const { info } = useDocument();
    return (): VNode => h('footer', { class: 'oref-footer' }, info.value.title);
  },
});

/** A replacement a consumer supplies for one slot, and nothing else. */
export const CustomFooter: Component = defineComponent({
  name: 'CustomFooter',
  setup() {
    const { info } = useDocument();
    return (): VNode =>
      h('footer', { class: 'oref-footer oref-custom' }, `built from ${info.value.title}`);
  },
});

/** The tree under test. */
export const SlottedTree = defineComponent({
  name: 'SlottedTree',
  setup() {
    const header = useSlot('operation.header', DefaultHeader);
    const parameters = useSlot('operation.parameters', DefaultParameters);
    const footer = useSlot('footer', DefaultFooter);

    return (): VNode =>
      h('div', { class: 'oref-root' }, [
        h('section', { 'data-region': 'operation.header' }, [h(header.value)]),
        h('section', { 'data-region': 'operation.parameters' }, [h(parameters.value)]),
        h('section', { 'data-region': 'footer' }, [h(footer.value)]),
      ]);
  },
});
