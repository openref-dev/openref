import type { IRDocument, IRNode } from '@openref/core';

/**
 * Walking a finished document and asking every reference in it whether its target is there.
 *
 * WHY IT IS A GENERIC WALK WHEN THE REWRITE BESIDE IT IS FIELD BY FIELD. The two are deliberately
 * not the same code. A rewrite that forgot a field would produce a document carrying a stale id,
 * and a checker written from the same list of fields would forget it in the same place and report
 * the document clean. This one starts from the value rather than from the type: everything that
 * is a string under a key the IR uses for a reference is a reference, wherever it turns out to be.
 *
 * WHAT IT SKIPS IS THE VERBATIM DATA, AND THE LIST IS THE WHOLE OF THE EXCEPTION. `extensions`,
 * `raw`, `bindings` and `discriminator.mapping` are carried through this pipeline exactly as the
 * source wrote them, and `example`, `examples`, `default`, `const` and `enum` are values out of the
 * described API rather than parts of the model. A `$ref` inside any of those is somebody else's
 * text that this project promises not to touch, so reading one as a reference would report a
 * document broken for carrying data faithfully.
 *
 * IT RUNS ON EVERY MERGE. `mergeDocuments` calls it on what it built and refuses to return a
 * document with a dangling reference, because the alternative is a reference that renders as a
 * missing schema or a dead link with nothing anywhere saying why.
 */

/** What sort of thing a reference was looking for. */
export type ReferenceKind = 'schema' | 'node' | 'security-scheme' | 'service';

/** One reference whose target is not in the document. */
export interface UnresolvedReference {
  readonly kind: ReferenceKind;
  /** The id that was referred to. */
  readonly target: string;
  /** Where in the document the reference is, as a slash separated path. */
  readonly at: string;
}

/** Property names that carry a reference, and what they refer to. */
const REFERENCE_KEYS: ReadonlyMap<string, ReferenceKind> = new Map<string, ReferenceKind>([
  ['schemaId', 'schema'],
  ['$ref', 'schema'],
  ['$cycle', 'schema'],
  ['schemeId', 'security-scheme'],
  ['nodeId', 'node'],
  ['serviceId', 'service'],
]);

/** Subtrees carried through verbatim, where a reference shaped string is somebody else's data. */
const VERBATIM_KEYS: ReadonlySet<string> = new Set([
  'extensions',
  'raw',
  'bindings',
  'mapping',
  'example',
  'examples',
  'default',
  'const',
  'enum',
]);

/**
 * Reports every reference in a document that resolves to nothing.
 *
 * `relationships` ARE STILL NOT CHECKED, AND THE REASON CHANGED AT `T052`. It used to be that the
 * type could not tell the two apart: `from` and `to` were documented as a node id **or** a service
 * name, so a value that was not a node id was not evidence of anything. SPEC 9.1 put the kind in
 * the type, so that reason is gone and a `node` end could now be checked exactly.
 *
 * IT IS STILL NOT, AND THE NEW REASON IS THE FEATURE RATHER THAN THE TYPE. A topology graph
 * describes an estate, and an estate is larger than any one federation: a service that declares it
 * publishes onto a channel documented by a service nobody federated in has declared a true thing,
 * and the graph draws it as a dead end on purpose, per SPEC 9.5. Reporting it here would turn every
 * partial federation into an incomplete merge, which is a refusal, so a correct topology edge would
 * stop a mount from serving.
 *
 * @param document - A finished document, merged or not
 * @returns Every unresolved reference, ordered by where it was found
 */
export function unresolvedReferences(document: IRDocument): UnresolvedReference[] {
  const findings: UnresolvedReference[] = [];
  const nodeIds = new Set([...document.nodes.keys(), ...document.webhooks.keys()]);
  const schemaIds = new Set(document.schemas.keys());
  const schemeIds = new Set(document.security.map((scheme) => scheme.id));
  const serviceIds = new Set((document.services ?? []).map((service) => service.id));

  const exists = (kind: ReferenceKind, target: string): boolean => {
    if (kind === 'schema') return schemaIds.has(target);
    if (kind === 'node') return nodeIds.has(target);
    if (kind === 'security-scheme') return schemeIds.has(target);
    return serviceIds.has(target);
  };

  const record = (kind: ReferenceKind, target: string, at: string): void => {
    if (!exists(kind, target)) findings.push({ kind, target, at });
  };

  walk(document, '', record, new WeakSet());

  // Callback targets are node ids in an array under a key that is the callback's own name, so
  // nothing about their position says what they are. They are named here rather than guessed at
  // by the walk, which would otherwise have to treat every string in every array as an id.
  for (const [id, node] of allNodes(document)) {
    if (node.kind !== 'operation' || node.callbacks === undefined) continue;
    for (const [name, targets] of Object.entries(node.callbacks)) {
      for (const target of targets) record('node', target, `nodes/${id}/callbacks/${name}`);
    }
  }

  return findings;
}

/**
 * Reports every entry whose map key and own id disagree.
 *
 * A SEPARATE ANSWER FROM AN UNRESOLVED REFERENCE, because the failure is the opposite way round: a
 * link built from the map key lands on a node whose page is written under the other name, and both
 * names exist. Merging is where it would happen, since the key and the id are set by two different
 * steps.
 *
 * @param document - A finished document, merged or not
 * @returns One message per disagreement, empty when every key matches
 */
export function mismatchedKeys(document: IRDocument): string[] {
  const problems: string[] = [];

  for (const [key, node] of document.nodes) {
    if (node.id !== key) problems.push(`nodes/${key} holds a node whose id is ${node.id}`);
  }
  for (const [key, node] of document.webhooks) {
    if (node.id !== key) problems.push(`webhooks/${key} holds a node whose id is ${node.id}`);
  }
  for (const [key, schema] of document.schemas) {
    if (schema.id !== key) problems.push(`schemas/${key} holds a schema whose id is ${schema.id}`);
  }

  return problems;
}

/** Nodes and webhooks together, which is the id space a callback target lives in. */
function* allNodes(document: IRDocument): Generator<[string, IRNode]> {
  yield* document.nodes;
  yield* document.webhooks;
}

/**
 * Walks any IR value, reporting the reference carrying strings it finds.
 *
 * @param value - The value at this position
 * @param at - Slash separated path to this position
 * @param record - Called with every reference found
 * @param seen - Objects already walked, so a shared sub-object is walked once
 */
function walk(
  value: unknown,
  at: string,
  record: (kind: ReferenceKind, target: string, at: string) => void,
  seen: WeakSet<object>,
): void {
  if (value === null || typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);

  if (value instanceof Map) {
    for (const [key, entry] of value) {
      walk(entry, `${at}/${String(key)}`, record, seen);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const [index, entry] of (value as readonly unknown[]).entries()) {
      walk(entry, `${at}/${String(index)}`, record, seen);
    }
    return;
  }

  for (const [key, entry] of Object.entries(value)) {
    if (VERBATIM_KEYS.has(key)) continue;

    const kind = REFERENCE_KEYS.get(key);
    if (kind !== undefined && typeof entry === 'string') {
      record(kind, entry, `${at}/${key}`);
      continue;
    }

    walk(entry, `${at}/${key}`, record, seen);
  }
}
