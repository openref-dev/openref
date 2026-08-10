/**
 * The navigation tree.
 *
 * Written as a render function rather than a single file component on purpose: an SFC
 * needs a template compiler in the build of every consumer of this package, and the
 * compiler is exactly the thing a strict policy forbids at runtime because it builds
 * functions from strings. A render function needs no compiler anywhere.
 *
 * Class names come from the vocabulary the default theme already declares, so that the
 * markup this package emits and the stylesheet that package ships agree without either
 * one importing the other.
 */

import { defineComponent, h, type PropType, type VNode } from 'vue';
import type { NavEntryModel } from '../page/domain/page-model';
import { nodeHref } from '../page/domain/links';

function itemClasses(entry: NavEntryModel, active: boolean): string[] {
  const classes = ['oref-nav-item'];
  if (entry.deprecated) classes.push('oref-deprecated');
  if (active) classes.push('oref-active');
  return classes;
}

function renderEntry(entry: NavEntryModel, activeNodeId: string | null, basePath: string): VNode {
  const active = entry.nodeId !== null && entry.nodeId === activeNodeId;

  const label =
    entry.nodeId === null
      ? h('span', { class: [...itemClasses(entry, false), 'oref-nav-group'] }, entry.label)
      : h(
          'a',
          {
            class: itemClasses(entry, active),
            href: nodeHref(entry.nodeId, basePath),
            'aria-current': active ? 'page' : undefined,
          },
          entry.label,
        );

  const children =
    entry.children.length === 0
      ? null
      : h(
          'ul',
          { class: 'oref-nav-list' },
          entry.children.map((child) => renderEntry(child, activeNodeId, basePath)),
        );

  return h('li', { class: 'oref-nav-entry', key: entry.id }, [label, children]);
}

/** Renders the document navigation as a nested list of links. */
export const NavigationTree = defineComponent({
  name: 'OrefNavigationTree',

  props: {
    entries: { type: Array as PropType<readonly NavEntryModel[]>, required: true },
    activeNodeId: { type: String as PropType<string | null>, default: null },
    basePath: { type: String, default: '' },
  },

  setup(props) {
    return (): VNode =>
      h(
        'ul',
        { class: 'oref-nav-list oref-nav-root' },
        props.entries.map((entry) => renderEntry(entry, props.activeNodeId, props.basePath)),
      );
  },
});
