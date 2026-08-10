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

const DefaultNotice = defineComponent({
  name: 'DefaultNotice',
  setup() {
    const { info } = useDocument();
    return (): VNode => h('p', { class: 'oref-notice' }, info.value.title);
  },
});

/** A replacement a consumer supplies for one slot, and nothing else. */
export const CustomNotice: Component = defineComponent({
  name: 'CustomNotice',
  setup() {
    const { info } = useDocument();
    return (): VNode =>
      h('p', { class: 'oref-notice oref-custom' }, `built from ${info.value.title}`);
  },
});

/** The tree under test. */
export const SlottedTree = defineComponent({
  name: 'SlottedTree',
  setup() {
    const header = useSlot('OperationHeader', DefaultHeader);
    const parameters = useSlot('ParamTable', DefaultParameters);
    const notice = useSlot('StateNotice', DefaultNotice);

    return (): VNode =>
      h('div', { class: 'oref-root' }, [
        h('section', { 'data-region': 'OperationHeader' }, [h(header.value)]),
        h('section', { 'data-region': 'ParamTable' }, [h(parameters.value)]),
        h('section', { 'data-region': 'StateNotice' }, [h(notice.value)]),
      ]);
  },
});
