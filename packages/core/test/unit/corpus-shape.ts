import type { IRDocument, IRJsonSchema, IRNavNode, IRNode } from '../../src/index';

/**
 * The shape of a normalized document: the readable half of a large document's snapshot.
 *
 * A digest pins every byte but says only that something moved. This says what moved, and it is
 * deliberately small enough that a person reads it in full, because a snapshot nobody reads
 * manufactures confidence rather than catching anything.
 *
 * Everything here is derived from IR alone and ordered canonically, so two runs of one document
 * produce one file.
 */

/** Counts of the reference nodes SPEC 5.1.1 defines. */
export interface ShapeReferences {
  /** `$ref` nodes inside schema bodies. */
  readonly refNodes: number;
  /** `$cycle` nodes, which exist only for cycles among targets that have no name. */
  readonly cycleNodes: number;
  /** Use sites that name a schema rather than inlining one. */
  readonly namedSlots: number;
  /** Use sites carrying an inline schema. */
  readonly inlineSlots: number;
}

/** The whole shape, before it is rendered. */
export interface DocumentShape {
  readonly nodesByKind: ReadonlyMap<string, number>;
  readonly webhooks: number;
  readonly schemas: number;
  readonly references: ShapeReferences;
  /** Named schemas that sit on a reference cycle, so a component of size above one or a self loop. */
  readonly schemasInCycle: number;
  /** Upper bound on the depth a cycle safe expander can reach. See {@link maxExpansionDepth}. */
  readonly maxExpansionDepth: number;
  /** Deepest nesting of anonymous schemas inside a single body, which is what `cycleDepth` bounds. */
  readonly maxAnonymousNesting: number;
  readonly nodesPerTag: readonly (readonly [string, number])[];
  readonly navigation: readonly NavigationSummary[];
}

/** One top level navigation entry and a summary of its children. */
export interface NavigationSummary {
  readonly kind: string;
  readonly label: string;
  readonly childCount: number;
  /** Child counts by kind, so a group turning from nodes into schemas is visible. */
  readonly childrenByKind: readonly (readonly [string, number])[];
  /** Children that are themselves groups, listed in full because they are structure, not leaves. */
  readonly childGroups: readonly (readonly [string, number])[];
}

/** Label used for an operation that declares no tag. */
const UNTAGGED = '(untagged)';

/**
 * Keys of a schema whose value is one or more schemas.
 *
 * Walking structurally rather than generically matters: `enum`, `const`, `default`, `examples`
 * and `extensions` hold arbitrary document data, which may itself contain a key named `$ref`
 * that is not a reference at all.
 */
function childSchemas(schema: IRJsonSchema): IRJsonSchema[] {
  const children: IRJsonSchema[] = [];

  const push = (value: IRJsonSchema | undefined): void => {
    if (value !== undefined) children.push(value);
  };
  const pushAll = (values: readonly IRJsonSchema[] | undefined): void => {
    if (values !== undefined) children.push(...values);
  };
  const pushRecord = (record: Readonly<Record<string, IRJsonSchema>> | undefined): void => {
    if (record !== undefined) children.push(...Object.values(record));
  };

  pushRecord(schema.properties);
  pushRecord(schema.patternProperties);
  push(schema.propertyNames);
  if (typeof schema.additionalProperties === 'object') push(schema.additionalProperties);
  push(schema.items);
  pushAll(schema.prefixItems);
  pushAll(schema.allOf);
  pushAll(schema.oneOf);
  pushAll(schema.anyOf);
  push(schema.not);
  if (schema.variants !== undefined) {
    children.push(...schema.variants.map((variant) => variant.schema));
  }

  return children;
}

interface BodyFacts {
  /** Nesting depth of anonymous schemas in this body, counting the root as one. */
  readonly depth: number;
  readonly refNodes: number;
  readonly cycleNodes: number;
  readonly targets: ReadonlySet<string>;
}

/** Walk one schema body. A `$ref` ends the walk at that position, because it does not expand. */
function readBody(root: IRJsonSchema): BodyFacts {
  const targets = new Set<string>();
  let refNodes = 0;
  let cycleNodes = 0;

  const walk = (schema: IRJsonSchema): number => {
    if (schema.$ref !== undefined) {
      refNodes += 1;
      targets.add(schema.$ref);
      return 1;
    }
    if (schema.$cycle !== undefined) {
      cycleNodes += 1;
      return 1;
    }

    let deepest = 0;
    for (const child of childSchemas(schema)) {
      deepest = Math.max(deepest, walk(child));
    }
    return deepest + 1;
  };

  return { depth: walk(root), refNodes, cycleNodes, targets };
}

/** Strongly connected components of the reference graph, in a deterministic order. */
function components(
  ids: readonly string[],
  edges: ReadonlyMap<string, ReadonlySet<string>>,
): {
  readonly componentOf: ReadonlyMap<string, number>;
  readonly members: readonly (readonly string[])[];
} {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const componentOf = new Map<string, number>();
  const members: string[][] = [];
  let counter = 0;

  const strongConnect = (id: string): void => {
    index.set(id, counter);
    low.set(id, counter);
    counter += 1;
    stack.push(id);
    onStack.add(id);

    for (const target of edges.get(id) ?? []) {
      if (!index.has(target)) {
        strongConnect(target);
        low.set(id, Math.min(low.get(id) ?? 0, low.get(target) ?? 0));
      } else if (onStack.has(target)) {
        low.set(id, Math.min(low.get(id) ?? 0, index.get(target) ?? 0));
      }
    }

    if (low.get(id) === index.get(id)) {
      const group: string[] = [];
      for (;;) {
        const popped = stack.pop();
        if (popped === undefined) break;
        onStack.delete(popped);
        group.push(popped);
        componentOf.set(popped, members.length);
        if (popped === id) break;
      }
      members.push(group.sort((a, b) => a.localeCompare(b)));
    }
  };

  for (const id of ids) {
    if (!index.has(id)) strongConnect(id);
  }

  return { componentOf, members };
}

/**
 * Upper bound on the depth a cycle safe expander can reach.
 *
 * The reference graph is condensed to its strongly connected components, which makes it a DAG
 * and therefore gives a finite longest path even though named cycles exist. A component is
 * weighted by the sum of its members' anonymous nesting, since an expander that stops on a
 * revisit can descend through each member of a cycle at most once.
 *
 * This is an upper bound rather than the exact figure. The exact longest simple path is not
 * worth computing here: the number exists to move when the graph changes, and a bound moves.
 */
function maxExpansionDepth(
  ids: readonly string[],
  facts: ReadonlyMap<string, BodyFacts>,
  edges: ReadonlyMap<string, ReadonlySet<string>>,
): number {
  const { componentOf, members } = components(ids, edges);

  const weight = members.map((group) =>
    group.reduce((sum, id) => sum + (facts.get(id)?.depth ?? 0), 0),
  );

  const outgoing = members.map((group) => {
    const out = new Set<number>();
    for (const id of group) {
      for (const target of edges.get(id) ?? []) {
        const component = componentOf.get(target);
        if (component !== undefined && component !== componentOf.get(id)) out.add(component);
      }
    }
    return [...out].sort((a, b) => a - b);
  });

  // Tarjan emits a component only after everything it points at, so this order is topological.
  const longest = members.map(() => 0);
  for (let component = 0; component < members.length; component += 1) {
    let deepest = 0;
    for (const target of outgoing[component] ?? []) {
      deepest = Math.max(deepest, longest[target] ?? 0);
    }
    longest[component] = (weight[component] ?? 0) + deepest;
  }

  return longest.reduce((best, value) => Math.max(best, value), 0);
}

/** Count the schema slots at a use site, which is where a named schema is referred to. */
function countSlots(nodes: Iterable<IRNode>): { named: number; inline: number } {
  let named = 0;
  let inline = 0;

  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value as readonly unknown[]) visit(item);
      return;
    }
    if (value === null || typeof value !== 'object') return;

    const record = value as { kind?: unknown; schemaId?: unknown; schema?: unknown };
    if (record.kind === 'named' && typeof record.schemaId === 'string') {
      named += 1;
      return;
    }
    if (record.kind === 'inline' && typeof record.schema === 'object') {
      inline += 1;
      return;
    }

    for (const [childKey, childValue] of Object.entries(record)) {
      // Extensions and example values hold arbitrary document data, never a slot.
      if (childKey === 'extensions' || childKey === 'examples' || childKey === 'example') continue;
      visit(childValue);
    }
  };

  for (const node of nodes) visit(node);
  return { named, inline };
}

function tally(values: Iterable<string>): (readonly [string, number])[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function summarizeNavigation(entry: IRNavNode): NavigationSummary {
  return {
    kind: entry.kind,
    label: entry.label,
    childCount: entry.children.length,
    childrenByKind: tally(entry.children.map((child) => child.kind)),
    childGroups: entry.children
      .filter((child) => child.kind === 'group')
      .map((child) => [child.label, child.children.length] as const),
  };
}

/** Derive the shape of a normalized document. */
export function documentShape(document: IRDocument): DocumentShape {
  const ids = [...document.schemas.keys()].sort((a, b) => a.localeCompare(b));

  const facts = new Map<string, BodyFacts>();
  for (const id of ids) {
    const normalized = document.schemas.get(id)?.normalized;
    facts.set(
      id,
      normalized === undefined
        ? { depth: 0, refNodes: 0, cycleNodes: 0, targets: new Set<string>() }
        : readBody(normalized),
    );
  }

  const edges = new Map<string, ReadonlySet<string>>();
  for (const id of ids) {
    const targets = new Set<string>();
    for (const target of facts.get(id)?.targets ?? []) {
      if (document.schemas.has(target)) targets.add(target);
    }
    edges.set(id, targets);
  }

  const { componentOf, members } = components(ids, edges);
  const schemasInCycle = ids.filter((id) => {
    const component = componentOf.get(id);
    if (component === undefined) return false;
    const group = members[component] ?? [];
    return group.length > 1 || (edges.get(id)?.has(id) ?? false);
  }).length;

  const slots = countSlots([...document.nodes.values(), ...document.webhooks.values()]);

  const tags: string[] = [];
  for (const node of document.nodes.values()) {
    if (node.tags.length === 0) tags.push(UNTAGGED);
    else tags.push(...node.tags);
  }

  return {
    nodesByKind: new Map(tally([...document.nodes.values()].map((node) => node.kind))),
    webhooks: document.webhooks.size,
    schemas: document.schemas.size,
    references: {
      refNodes: ids.reduce((sum, id) => sum + (facts.get(id)?.refNodes ?? 0), 0),
      cycleNodes: ids.reduce((sum, id) => sum + (facts.get(id)?.cycleNodes ?? 0), 0),
      namedSlots: slots.named,
      inlineSlots: slots.inline,
    },
    schemasInCycle,
    maxExpansionDepth: maxExpansionDepth(ids, facts, edges),
    maxAnonymousNesting: ids.reduce((best, id) => Math.max(best, facts.get(id)?.depth ?? 0), 0),
    nodesPerTag: tally(tags),
    navigation: document.navigation.map(summarizeNavigation),
  };
}

function table(header: readonly string[], rows: readonly (readonly string[])[]): string {
  return [header, header.map(() => '---'), ...rows]
    .map((row) => `| ${row.join(' | ')} |`)
    .join('\n');
}

/** Render the shape as the committed snapshot. */
export function renderShape(file: string, shape: DocumentShape): string {
  const counts: (readonly string[])[] = [
    ...[...shape.nodesByKind.entries()].map(
      ([kind, count]) => [`nodes, ${kind}`, String(count)] as const,
    ),
    ['webhooks', String(shape.webhooks)],
    ['schemas', String(shape.schemas)],
    ['schemas on a reference cycle', String(shape.schemasInCycle)],
    ['references, `$ref` nodes', String(shape.references.refNodes)],
    ['references, `$cycle` nodes', String(shape.references.cycleNodes)],
    ['use sites naming a schema', String(shape.references.namedSlots)],
    ['use sites inlining a schema', String(shape.references.inlineSlots)],
    ['max anonymous nesting', String(shape.maxAnonymousNesting)],
    ['max expansion depth', String(shape.maxExpansionDepth)],
  ];

  const navigation = shape.navigation
    .map((entry) => {
      const kinds = entry.childrenByKind
        .map(([kind, count]) => `${String(count)} ${kind}`)
        .join(', ');
      const head = `- ${entry.kind} ${entry.label} (${String(entry.childCount)})`;
      const lines = [entry.childCount === 0 ? head : `${head}: ${kinds}`];
      for (const [label, count] of entry.childGroups) {
        lines.push(`  - group ${label} (${String(count)})`);
      }
      return lines.join('\n');
    })
    .join('\n');

  return `# Shape of ${file}

The readable half of this document's snapshot. Its digest beside it pins every byte but says
only that something moved; this says what moved. It is kept short on purpose, because the whole
argument for having it is that a person reads it in full.

Every figure is derived from IR alone, on the same canonical ordering as every other artefact.

\`max expansion depth\` is an upper bound on how deep a cycle safe expander can descend: the
longest path of the reference graph with its strongly connected components collapsed, each
component weighted by the anonymous nesting of its members. It is finite even where named
cycles exist, and named cycles do exist, which is why \`schemas on a reference cycle\` is a row.

## Counts

${table(['what', 'count'], counts)}

## Nodes per tag

${table(
  ['tag', 'nodes'],
  shape.nodesPerTag.map(([tag, count]) => [tag, String(count)]),
)}

## Navigation, two levels

Leaf children are counted by kind rather than listed. Their ids are in the digest, which is
where a list of six hundred entries belongs. A child that is itself a group is listed in full,
because that is structure rather than content.

${navigation}
`;
}
