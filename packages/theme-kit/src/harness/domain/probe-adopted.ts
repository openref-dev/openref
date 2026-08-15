/**
 * The probe that catches a dead override before a reader does, per SPEC 10.4 and `TX-ADOPT`.
 *
 * A SERVER RESOLVED POSITION NEVER HYDRATES: the browser fills it with a childless element
 * that adopts the server's markup, so an override's handler is never attached and its state
 * never redraws anything. The author sees their component render on the server and believes
 * it works; the first reader to press its control finds it dead. That is the F14 class with a
 * theme as its cause, and this is where it is nameable, at authoring time.
 *
 * HOW HANDLERS ARE FOUND, AND WHAT THE APPROXIMATION IS. The component is mounted once
 * through a custom renderer whose every node operation is a stub, which runs the real client
 * mount path in Node: `patchProp` receives every prop Vue would attach to a DOM element, and
 * a key of the `onEvent` shape holding a function is a listener that would never be attached
 * in the adopted position. Client state without any handler is undetectable this way and also
 * inert: state nothing can change redraws nothing. Stated per the standing rule on
 * approximations.
 *
 * THE ROOT ELEMENT TYPE IS CHECKED ON THE SAME MOUNT. Production hydration replaces a node
 * whose element type differs from the stub's, so an override that changes the root tag loses
 * its whole markup the moment the page hydrates, silently. `SERVER_RESOLVED_ROOTS` is the one
 * home of the expected tags, shared with the renderer's stubs.
 */

import { createRenderer, type Component } from 'vue';
import {
  SERVER_RESOLVED_ROOTS,
  SERVER_RESOLVED_SLOTS,
  type ServerResolvedSlot,
  type SlotName,
} from '@openref/vue';

/** What the probe found wrong with one override, in the author's words. */
export interface AdoptedSlotProblem {
  readonly slot: ServerResolvedSlot;
  readonly kind: 'client-state' | 'wrong-root';
  readonly message: string;
}

/** A node of the probe's stub tree, shaped just enough for the renderer contract. */
interface ProbeNode {
  tag: string;
  children: ProbeNode[];
  parent: ProbeNode | null;
  text?: string;
}

/** The sentence both refusals lead with, naming the list rather than only the name. */
function serverResolvedSentence(slot: string): string {
  return (
    `"${slot}" is a server resolved position: its override renders on the server and the ` +
    `browser adopts that markup without hydrating it. The server resolved positions are ` +
    `${SERVER_RESOLVED_SLOTS.join(', ')}.`
  );
}

/** Whether a name is one of the server resolved positions. */
export function isServerResolved(name: SlotName): name is ServerResolvedSlot {
  return (SERVER_RESOLVED_SLOTS as readonly SlotName[]).includes(name);
}

/**
 * Mounts one override headlessly and reports what would be dead in the adopted position.
 *
 * @param slot - The server resolved position the theme overrides
 * @param component - The override
 * @param props - The contract props for the position, from the caller
 * @returns Every problem found, empty when the override is safe to adopt
 */
export function probeAdoptedSlot(
  slot: ServerResolvedSlot,
  component: Component,
  props: Record<string, unknown>,
): AdoptedSlotProblem[] {
  const handlers: string[] = [];

  const makeNode = (tag: string): ProbeNode => ({ tag, children: [], parent: null });

  const { createApp } = createRenderer<ProbeNode, ProbeNode>({
    patchProp: (_el, key, _prev, next) => {
      if (/^on[A-Z]/.test(key) && typeof next === 'function') handlers.push(key);
    },
    insert: (child, parent, anchor) => {
      child.parent = parent;
      const at = anchor === null || anchor === undefined ? -1 : parent.children.indexOf(anchor);
      if (at === -1) parent.children.push(child);
      else parent.children.splice(at, 0, child);
    },
    remove: (child) => {
      const parent = child.parent;
      if (parent === null) return;
      const at = parent.children.indexOf(child);
      if (at !== -1) parent.children.splice(at, 1);
    },
    createElement: (tag) => makeNode(tag),
    createText: (text) => ({ ...makeNode('#text'), text }),
    createComment: () => makeNode('#comment'),
    setText: (node, text) => {
      node.text = text;
    },
    setElementText: (node, text) => {
      node.children = [];
      node.text = text;
    },
    parentNode: (node) => node.parent,
    nextSibling: (node) => {
      const parent = node.parent;
      if (parent === null) return null;
      return parent.children[parent.children.indexOf(node) + 1] ?? null;
    },
  });

  const root = makeNode('#root');
  const app = createApp(component, props);
  // A component that throws is the harness's own outcome, reported beside the name there;
  // this probe answers only the two questions adoption adds.
  app.config.warnHandler = () => undefined;
  app.mount(root);

  const problems: AdoptedSlotProblem[] = [];

  if (handlers.length > 0) {
    problems.push({
      slot,
      kind: 'client-state',
      message:
        `${serverResolvedSentence(slot)} This override attaches ` +
        `${[...new Set(handlers)].sort().join(', ')}, and no listener in this position is ` +
        `ever attached: the control it belongs to is dead for every reader. Draw this ` +
        `position static, or move the interaction into a position the client hydrates.`,
    });
  }

  const expected = SERVER_RESOLVED_ROOTS[slot];
  const rootTag = root.children.find((child) => child.tag !== '#comment')?.tag;
  if (expected !== undefined && rootTag !== undefined && rootTag !== expected) {
    problems.push({
      slot,
      kind: 'wrong-root',
      message:
        `${serverResolvedSentence(slot)} Its root element must stay <${expected}>: the ` +
        `browser adopts the position through a childless <${expected}>, and production ` +
        `hydration replaces a root of another type with that empty element, losing the ` +
        `markup. This override's root is <${rootTag}>.`,
    });
  }

  app.unmount();

  return problems;
}
