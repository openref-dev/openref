import type { IRNavNode } from '../../ir/domain/document.types';
import type { IRNode } from '../../ir/domain/node.types';
import type { IRSchema } from '../../ir/domain/schema.types';

/**
 * Navigation tree, per BUILD T004.
 *
 * Ordering is derived from the document: the order tags are declared in, then the order nodes
 * appear in. Nothing here reads object iteration order of a map keyed by anything a document
 * controls, so a shuffled input produces the same tree.
 */

/** A tag as declared in the document, including the 3.2 hierarchy. */
export interface NavigationTag {
  readonly name: string;
  readonly summary?: string;
  /** Name of the parent tag, from the OpenAPI 3.2 Tag Object. */
  readonly parent?: string;
}

/** Input to {@link buildNavigation}. */
export interface BuildNavigationOptions {
  /** Tags in the order the document declares them. */
  readonly tags: readonly NavigationTag[];
  /** Nodes in document order. */
  readonly nodes: readonly IRNode[];
  /** Named schemas in document order. */
  readonly schemas?: readonly IRSchema[];
  /** Label of the group that collects nodes carrying no tag. */
  readonly untaggedLabel?: string;
  /** Label of the group that collects named schemas. */
  readonly schemasLabel?: string;
}

/** A mutable navigation entry, so children can be filled in as nodes are placed. */
interface Draft {
  readonly id: string;
  readonly label: string;
  readonly kind: IRNavNode['kind'];
  nodeId?: string;
  schemaId?: string;
  deprecated?: boolean;
  readonly children: Draft[];
}

function slug(text: string): string {
  const cleaned = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned === '' ? 'group' : cleaned;
}

function labelOf(node: IRNode): string {
  if (node.kind === 'operation') {
    return node.summary ?? `${node.method.toUpperCase()} ${node.path}`;
  }
  return node.title ?? node.address ?? node.id;
}

function entryFor(node: IRNode): Draft {
  const draft: Draft = {
    id: `nav-${node.id}`,
    label: labelOf(node),
    kind: 'node',
    nodeId: node.id,
    children: [],
  };
  if (node.deprecated) draft.deprecated = true;
  return draft;
}

/** Reports whether a group holds anything, so an unused declared tag leaves no empty entry. */
function hasContent(draft: Draft): boolean {
  if (draft.kind !== 'group') return true;
  return draft.children.some((child) => hasContent(child));
}

function freeze(draft: Draft): IRNavNode {
  const entry: { -readonly [Key in keyof IRNavNode]: IRNavNode[Key] } = {
    id: draft.id,
    label: draft.label,
    kind: draft.kind,
    children: draft.children.filter((child) => hasContent(child)).map((child) => freeze(child)),
  };

  if (draft.nodeId !== undefined) entry.nodeId = draft.nodeId;
  if (draft.schemaId !== undefined) entry.schemaId = draft.schemaId;
  if (draft.deprecated !== undefined) entry.deprecated = draft.deprecated;

  return entry;
}

/**
 * Collects tag names in the order the document establishes them.
 *
 * Declared tags come first, in declaration order. A tag used by a node but never declared is
 * appended when it is first met, so an undeclared tag is documented rather than dropped.
 */
function orderedTagNames(options: BuildNavigationOptions): string[] {
  const ordered: string[] = [];

  for (const tag of options.tags) {
    if (!ordered.includes(tag.name)) ordered.push(tag.name);
  }

  for (const node of options.nodes) {
    for (const name of node.tags) {
      if (!ordered.includes(name)) ordered.push(name);
    }
  }

  return ordered;
}

/**
 * Builds the navigation tree.
 *
 * A node is placed under its first tag, so it appears exactly once. A tag that declares a
 * `parent` becomes a child of that tag, which is how OpenAPI 3.2 expresses a hierarchy. A tag
 * whose parent is missing, or which would form a cycle, is placed at the top level rather than
 * dropped.
 *
 * @param options - Tags, nodes and schemas, each in document order
 * @returns The navigation tree, ordered by the document
 */
export function buildNavigation(options: BuildNavigationOptions): IRNavNode[] {
  const declared = new Map<string, NavigationTag>();
  for (const tag of options.tags) {
    if (!declared.has(tag.name)) declared.set(tag.name, tag);
  }

  const groups = new Map<string, Draft>();
  for (const name of orderedTagNames(options)) {
    const tag = declared.get(name);
    groups.set(name, {
      id: `group-${slug(name)}`,
      label: tag?.summary ?? name,
      kind: 'group',
      children: [],
    });
  }

  const parentOf = (name: string): string | undefined => {
    const parent = declared.get(name)?.parent;
    if (parent === undefined || parent === name || !groups.has(parent)) return undefined;

    // Walk up to make sure the chain terminates; a cycle leaves the tag at the top level.
    const walked = new Set<string>([name]);
    let cursor: string | undefined = parent;
    while (cursor !== undefined) {
      if (walked.has(cursor)) return undefined;
      walked.add(cursor);
      cursor = declared.get(cursor)?.parent;
    }

    return parent;
  };

  const roots: Draft[] = [];
  for (const [name, group] of groups) {
    const parent = parentOf(name);
    const parentGroup = parent === undefined ? undefined : groups.get(parent);

    if (parentGroup === undefined) {
      roots.push(group);
    } else {
      parentGroup.children.push(group);
    }
  }

  const untagged: Draft = {
    id: 'group-untagged',
    label: options.untaggedLabel ?? 'Other',
    kind: 'group',
    children: [],
  };

  for (const node of options.nodes) {
    const firstTag = node.tags[0];
    const group = firstTag === undefined ? untagged : groups.get(firstTag);
    (group ?? untagged).children.push(entryFor(node));
  }

  if (untagged.children.length > 0) roots.push(untagged);

  const schemas = options.schemas ?? [];
  if (schemas.length > 0) {
    roots.push({
      id: 'group-schemas',
      label: options.schemasLabel ?? 'Schemas',
      kind: 'group',
      children: schemas.map((schema) => ({
        id: `nav-schema-${schema.id}`,
        label: schema.name ?? schema.id,
        kind: 'schema' as const,
        schemaId: schema.id,
        children: [],
      })),
    });
  }

  return roots.filter((draft) => hasContent(draft)).map((draft) => freeze(draft));
}
