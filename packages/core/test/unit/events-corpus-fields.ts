/**
 * What the event corpus writes at the six positions SPEC 8.2 recorded as unheld by the IR.
 *
 * THIS IS MEASURED FROM THE INPUT DOCUMENT AND NOT FROM THE IR, deliberately. The question the
 * maintainer's ruling of 2026-08-29 asks is whether the world writes a member the IR has nowhere
 * to put, and an IR that has nowhere to put it answers that question with silence whatever the
 * documents say. So this walk reads the parsed specification, and the harness compares its answer
 * with the IR afterwards: raw says what was written, IR says what survived, and a member that is
 * written and does not survive is exactly the finding.
 *
 * IT IS A SECOND IMPLEMENTATION ON PURPOSE. Asking the normalizer how many operations write
 * `reply` would be the normalizer marking its own homework, so the reference resolution and the
 * trait merge below are written again here, small and readable, against the same specification
 * text. Where the two disagree, one of them is wrong and a case goes red.
 */

/** The six members of SPEC 8.2's dropped list, in the order that section names them. */
export const EVENT_FIELD_SUBJECTS = [
  'servers[].bindings',
  'servers[].security',
  'operations[].reply',
  'operations[].security',
  'operations[].tags',
  'messages[].tags',
] as const;

/** One of the six. */
export type EventFieldSubject = (typeof EVENT_FIELD_SUBJECTS)[number];

/** How many positions of one document write each member. */
export type EventFieldUsage = Readonly<Record<EventFieldSubject, number>>;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Follows a local `$ref` chain to the object it names.
 *
 * IT THROWS RATHER THAN RETURNING NOTHING when a reference cannot be followed. A walker that
 * quietly skips what it cannot resolve reports zero uses of every member of the object it skipped,
 * which is the answer meaning "the corpus does not use this" arrived at by not looking.
 *
 * @param document - The parsed document, which is the only file a structural reference may name
 * @param value - The member as written
 * @returns The object it names
 * @throws {Error} When the reference leaves the document, resolves to nothing, or loops
 */
function resolve(document: unknown, value: unknown): Record<string, unknown> | undefined {
  const seen = new Set<unknown>();
  let current = value;

  while (isObject(current) && typeof current.$ref === 'string') {
    const reference = current.$ref;
    if (seen.has(current)) throw new Error(`reference chain loops at ${reference}`);
    seen.add(current);

    if (!reference.startsWith('#/')) {
      throw new Error(`this walk reads one document and ${reference} names another`);
    }

    let target: unknown = document;
    for (const segment of reference.slice(2).split('/')) {
      const key = segment.replaceAll('~1', '/').replaceAll('~0', '~');
      target = isObject(target) ? target[key] : undefined;
    }

    if (target === undefined) throw new Error(`${reference} resolves to nothing`);
    current = target;
  }

  return isObject(current) ? current : undefined;
}

/**
 * Whether an object, or any trait it declares, writes a member.
 *
 * TRAITS COUNT, because the merge AsyncAPI defines fills a member the target left out, so an
 * operation whose `tags` live in a trait is an operation with tags. This mirrors the normalizer's
 * `applyTraits` at the one depth these six members live at.
 *
 * @param document - The parsed document
 * @param source - The object, already resolved
 * @param member - The member name
 * @returns True when the merged object would carry the member
 */
function writes(document: unknown, source: Record<string, unknown>, member: string): boolean {
  if (source[member] !== undefined) return true;

  const traits = source.traits;
  if (!Array.isArray(traits)) return false;

  return (traits as readonly unknown[]).some(
    (entry) => resolve(document, entry)?.[member] !== undefined,
  );
}

/** Every value of a map member of the document, resolved, in the document's own order. */
function entriesOf(document: unknown, map: unknown): Record<string, unknown>[] {
  if (!isObject(map)) return [];

  const values: Record<string, unknown>[] = [];
  for (const value of Object.values(map)) {
    const resolved = resolve(document, value);
    if (resolved !== undefined) values.push(resolved);
  }

  return values;
}

/**
 * Counts the positions of one AsyncAPI document that write each of the six members.
 *
 * THE POSITIONS WALKED ARE THE ONES THAT REACH THE IR. A server counts when the root `servers`
 * block names it, an operation when the root `operations` block does, and a message when a root
 * channel's own `messages` block does, because those are the three blocks the normalizer builds
 * nodes from. A definition sitting unreferenced in `components` describes nothing the reader ever
 * sees, so counting it would inflate the answer with material no page can reach.
 *
 * @param document - The parsed AsyncAPI document
 * @returns The number of positions writing each member
 * @throws {Error} When a reference cannot be followed inside the document
 *
 * @example
 * eventFieldUsage(parseSpecification(text))['operations[].reply'];
 */
export function eventFieldUsage(document: unknown): EventFieldUsage {
  const usage: Record<EventFieldSubject, number> = {
    'servers[].bindings': 0,
    'servers[].security': 0,
    'operations[].reply': 0,
    'operations[].security': 0,
    'operations[].tags': 0,
    'messages[].tags': 0,
  };

  if (!isObject(document)) return usage;

  for (const server of entriesOf(document, document.servers)) {
    if (writes(document, server, 'bindings')) usage['servers[].bindings'] += 1;
    if (writes(document, server, 'security')) usage['servers[].security'] += 1;
  }

  for (const operation of entriesOf(document, document.operations)) {
    if (writes(document, operation, 'reply')) usage['operations[].reply'] += 1;
    if (writes(document, operation, 'security')) usage['operations[].security'] += 1;
    if (writes(document, operation, 'tags')) usage['operations[].tags'] += 1;
  }

  for (const channel of entriesOf(document, document.channels)) {
    for (const message of entriesOf(document, channel.messages)) {
      if (writes(document, message, 'tags')) usage['messages[].tags'] += 1;
    }
  }

  return usage;
}
