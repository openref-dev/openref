import { computed, defineComponent, h } from 'vue';
import type { Component, VNode } from 'vue';
import type { SchemaTreeNode } from '../../src/index';
import { useDocument, useOperation, useSchemaView, useTheme } from '../../src/index';

/**
 * A miniature reference, built out of composables and nothing else.
 *
 * This is the M0 done-when of T008 made checkable: a component tree renders an operation
 * without any direct store access. Nothing here injects the state, reads the injection key or
 * imports `useDocState`, and `component-tree.spec.ts` asserts that by reading this file.
 *
 * It renders with `h` rather than as an SFC because the headless package ships no components
 * and therefore has no SFC compiler in its build. What is under test is the state layer.
 */

const SchemaRow: Component = defineComponent({
  name: 'SchemaRow',
  props: { node: { type: Object as () => SchemaTreeNode, required: true } },
  setup(props) {
    const schemaView = useSchemaView();

    return (): VNode =>
      h('li', { class: 'oref-schema-row' }, [
        h('span', { class: 'oref-schema-label' }, props.node.label),
        props.node.cycle ? h('span', { class: 'oref-schema-cycle' }, 'cycle') : null,
        h(
          'ul',
          schemaView
            .children(props.node)
            .map((child) => h(SchemaRow, { key: child.path, node: child })),
        ),
      ]);
  },
});

const OperationHeader = defineComponent({
  name: 'OperationHeader',
  setup() {
    const { operation, deprecated } = useOperation();

    return () =>
      h('header', { class: 'oref-operation-header' }, [
        h('h2', {}, operation.value?.title ?? ''),
        h('code', {}, `${operation.value?.node.method ?? ''} ${operation.value?.node.path ?? ''}`),
        deprecated.value ? h('span', { class: 'oref-deprecated' }, 'deprecated') : null,
      ]);
  },
});

const OperationParameters = defineComponent({
  name: 'OperationParameters',
  setup() {
    const { parameters } = useOperation();

    return () =>
      h(
        'ul',
        { class: 'oref-parameters' },
        [...parameters.value.entries()].map(([location, group]) =>
          h('li', { key: location }, [
            h('span', { class: 'oref-parameter-in' }, location),
            h(
              'ul',
              group.map((parameter) => h('li', { key: parameter.name }, parameter.name)),
            ),
          ]),
        ),
      );
  },
});

const OperationResponses = defineComponent({
  name: 'OperationResponses',
  setup() {
    const { responses } = useOperation();
    const schemaView = useSchemaView();

    return () =>
      h(
        'ul',
        { class: 'oref-responses' },
        responses.value.map((response) =>
          h('li', { key: response.statusCode }, [
            h('span', { class: 'oref-status' }, response.statusCode),
            ...response.content.map((media) => {
              const root =
                media.schema === undefined
                  ? undefined
                  : schemaView.slotRoot(media.schema, media.mediaType);
              return root === undefined
                ? h('span', { class: 'oref-media' }, media.mediaType)
                : h('ul', { key: media.mediaType }, [h(SchemaRow, { node: root })]);
            }),
          ]),
        ),
      );
  },
});

/** The whole miniature reference: a sidebar, a header, parameters and responses. */
export const ReferenceTree = defineComponent({
  name: 'ReferenceTree',
  setup() {
    const { info, navigation, activeNodeId } = useDocument();
    const { name } = useTheme();
    const title = computed(() => `${info.value.title} ${info.value.version}`);

    return () =>
      h('main', { class: 'oref-root', 'data-oref-theme': name.value }, [
        h('h1', {}, title.value),
        h(
          'nav',
          { class: 'oref-sidebar' },
          navigation.value.map((group) =>
            h('section', { key: group.id }, [
              h('h3', {}, group.label),
              h(
                'ul',
                group.children.map((child) =>
                  h(
                    'li',
                    {
                      key: child.id,
                      class:
                        child.nodeId !== undefined && child.nodeId === activeNodeId.value
                          ? 'oref-active'
                          : undefined,
                    },
                    child.label,
                  ),
                ),
              ),
            ]),
          ),
        ),
        h('article', { class: 'oref-operation' }, [
          h(OperationHeader),
          h(OperationParameters),
          h(OperationResponses),
        ]),
      ]);
  },
});
