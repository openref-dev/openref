import { caseFoldForFilesystem, ErrorCode, MergeConflictError } from '@openref/core';
import type { FederationConflictMode } from './federation-options';
import { compareText } from './merge-report';

/**
 * Deciding what a thing is called in the merged document, per SPEC 15's `onConflict`.
 *
 * ONE RESOLVER FOR EVERY NAME SPACE, because the three modes have to mean the same thing about a
 * schema, a security scheme and an address, and three copies of a policy is how two of them come
 * to disagree. What differs between the spaces is supplied: how a name is keyed, how a service
 * namespaces one, and how a name that is still taken gets out of the way.
 *
 * WHAT `first-wins` WINS IS THE NAME, NOT THE RIGHT TO EXIST. The reading where the later service
 * is discarded was rejected at T044 for one reason: the done-when of the task is that merging is
 * lossless, and a reference that quietly omits an endpoint a service really serves is the failure
 * this project calls a lie rather than a policy. So under `first-wins` the first service keeps the
 * plain name and every other claimant is namespaced, which differs from `namespace`, where nobody
 * keeps it. Both are lossless; `fail` is the mode that produces no document at all.
 *
 * FIRST IS THE LOWEST SERVICE ID AND NOT THE FIRST REMOTE CONFIGURED. Merge output has to be
 * identical under shuffled remote ordering, and a policy that reads the input order is the one
 * thing that cannot be.
 */

/** One thing asking to be called something. */
export interface NameClaim<T> {
  /** The name it would have if nothing else wanted it. */
  readonly name: string;
  /** Services behind this claim, sorted. More than one when a schema class spans services. */
  readonly serviceIds: readonly string[];
  /** Whatever the caller needs back, carried through untouched. */
  readonly subject: T;
}

/** What a claim ended up being called. */
export interface ResolvedName<T> {
  readonly subject: T;
  /** The name in the merged document. */
  readonly name: string;
  /** The name the claim asked for. */
  readonly preferred: string;
  /** Service whose id was put in front, when the mode namespaced this claim. */
  readonly namespacedBy?: string;
  /** The other services that keyed the same name, sorted. Empty when nothing contested it. */
  readonly contestedBy: readonly string[];
  /** Whether the name had to be moved again because the resolved one was still taken. */
  readonly escaped: boolean;
}

/** How one name space keys, namespaces and escapes. */
export interface NameSpaceRules<T> {
  /** What this space calls the space's own word for the thing, used in a `fail` message. */
  readonly subjectLabel: string;
  /** The key two claims collide on. Two claims with one key are a conflict. */
  readonly keyOf: (name: string, subject: T) => string;
  /** The name a service's claim takes when the mode moves it out of the plain name. */
  readonly namespace: (name: string, serviceId: string, subject: T) => string;
  /** The name to try when the resolved one is taken by something else. */
  readonly escape: (name: string, attempt: number) => string;
}

/** Longest run of escapes before a merge gives up rather than looping. */
const MAX_ESCAPE_ATTEMPTS = 1000;

/**
 * Keys an identifier the way a case insensitive filesystem does.
 *
 * IT IS THE FOLD AND NOT THE LITERAL, AND THAT IS A FINDING RATHER THAN CAUTION. Two services can
 * each build cleanly, one holding `User` and the other `user`, and merging them with a literal key
 * puts both plain ids in one document, which the static build of `T043` then refuses whole. The
 * merge is the last place that can still rename one of them, so it is the place that has to see
 * them as one name.
 *
 * @param name - An id that will become a page address and a file name
 * @returns The comparison key, never for display
 */
export function identifierKey(name: string): string {
  return caseFoldForFilesystem(name);
}

/** The `<serviceId>_<name>` form of SPEC 15, used for every identifier space. */
export function namespaceIdentifier(name: string, serviceId: string): string {
  return `${serviceId}_${name}`;
}

/** The escape for an identifier: a numeric tail, since a tail keeps the readable part in front. */
export function escapeIdentifier(name: string, attempt: number): string {
  return `${name}_${String(attempt)}`;
}

/**
 * Resolves every claim in one name space.
 *
 * @param claims - The claims, in an order the caller derived deterministically
 * @param mode - The policy from SPEC 15
 * @param rules - How this space keys, namespaces and escapes
 * @returns One result per claim, in the order the claims were given
 * @throws {MergeConflictError} Under `fail`, when two services claim one name
 */
export function resolveNames<T>(
  claims: readonly NameClaim<T>[],
  mode: FederationConflictMode,
  rules: NameSpaceRules<T>,
): ResolvedName<T>[] {
  const groups = new Map<string, NameClaim<T>[]>();

  for (const claim of claims) {
    const key = rules.keyOf(claim.name, claim.subject);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [claim]);
    else group.push(claim);
  }

  const preferred = new Map<NameClaim<T>, PreferredName>();

  for (const [key, group] of groups) {
    if (group.length === 1) {
      const [only] = group;
      if (only !== undefined) preferred.set(only, { name: only.name, contestedBy: [] });
      continue;
    }

    if (mode === 'fail') throw conflictError(key, group, rules);

    const ordered = [...group].sort(compareClaims);
    const services = sortedServices(group);

    for (const [index, claim] of ordered.entries()) {
      const keepsPlainName = mode === 'first-wins' && index === 0;
      const owner = claim.serviceIds[0] ?? '';
      const contestedBy = services.filter((id) => !claim.serviceIds.includes(id));

      preferred.set(
        claim,
        keepsPlainName
          ? { name: claim.name, contestedBy }
          : {
              name: rules.namespace(claim.name, owner, claim.subject),
              namespacedBy: owner,
              contestedBy,
            },
      );
    }
  }

  return allocate(claims, preferred, rules);
}

/**
 * Hands out names in a space where nothing is contested, only possibly taken.
 *
 * THE NODE ID SPACE IS THIS ONE. SPEC 15 prefixes every node id with its service whether or not
 * anything clashed, so by the time a name reaches here the policy has already had its say and two
 * claims meeting is arithmetic rather than disagreement: service `a` with a node `b_c` and service
 * `a_b` with a node `c` both ask for `a_b_c`. Answering that with `onConflict` would refuse a merge
 * under `fail` for something no configuration caused and no configuration can fix.
 *
 * @param claims - The claims, in an order the caller derived deterministically
 * @param rules - How this space keys and escapes; its `namespace` is never called
 * @returns One result per claim, in the order the claims were given
 */
export function allocateUnique<T>(
  claims: readonly NameClaim<T>[],
  rules: NameSpaceRules<T>,
): ResolvedName<T>[] {
  return allocate(claims, new Map<NameClaim<T>, PreferredName>(), rules);
}

/** A name a claim has been given before uniqueness is checked. */
interface PreferredName {
  readonly name: string;
  readonly namespacedBy?: string;
  readonly contestedBy: readonly string[];
}

/**
 * Hands out the resolved names, moving any that is still taken.
 *
 * A NAME CAN STILL BE TAKEN AFTER THE POLICY HAS RUN, and the case is not exotic. Service `a`
 * with a node `b_c` and service `a_b` with a node `c` both produce the merged node id `a_b_c`,
 * because prefixing is concatenation and concatenation is not injective. So is a namespaced name
 * that happens to equal a plain name another service already had.
 */
function allocate<T>(
  claims: readonly NameClaim<T>[],
  preferred: ReadonlyMap<NameClaim<T>, PreferredName>,
  rules: NameSpaceRules<T>,
): ResolvedName<T>[] {
  const taken = new Set<string>();
  const results: ResolvedName<T>[] = [];

  for (const claim of claims) {
    const choice = preferred.get(claim) ?? { name: claim.name, contestedBy: [] };
    let name = choice.name;
    let escaped = false;

    for (let attempt = 2; taken.has(rules.keyOf(name, claim.subject)); attempt += 1) {
      if (attempt > MAX_ESCAPE_ATTEMPTS) {
        throw new MergeConflictError(
          `the ${rules.subjectLabel} name ${JSON.stringify(choice.name)} could not be made ` +
            `unique in ${String(MAX_ESCAPE_ATTEMPTS)} attempts`,
          ErrorCode.FED_MERGE_CONFLICT,
          undefined,
          { name: choice.name, subject: rules.subjectLabel },
        );
      }
      name = rules.escape(choice.name, attempt);
      escaped = true;
    }

    taken.add(rules.keyOf(name, claim.subject));

    const result: { -readonly [Key in keyof ResolvedName<T>]: ResolvedName<T>[Key] } = {
      subject: claim.subject,
      name,
      preferred: claim.name,
      contestedBy: choice.contestedBy,
      escaped,
    };
    if (choice.namespacedBy !== undefined) result.namespacedBy = choice.namespacedBy;

    results.push(result);
  }

  return results;
}

/** Orders the claims of one group, so which of them keeps the plain name is not the input order. */
function compareClaims<T>(left: NameClaim<T>, right: NameClaim<T>): number {
  const byService = compareText(left.serviceIds[0] ?? '', right.serviceIds[0] ?? '');
  if (byService !== 0) return byService;
  return compareText(left.name, right.name);
}

/** Every service behind a group of claims, sorted and without repeats. */
function sortedServices<T>(group: readonly NameClaim<T>[]): string[] {
  return [...new Set(group.flatMap((claim) => claim.serviceIds))].sort(compareText);
}

/** The refusal of `fail` mode, naming what was claimed and who claimed it. */
function conflictError<T>(
  key: string,
  group: readonly NameClaim<T>[],
  rules: NameSpaceRules<T>,
): MergeConflictError {
  const names = [...new Set(group.map((claim) => claim.name))].sort(compareText);
  const services = sortedServices(group);

  return new MergeConflictError(
    `onConflict is "fail" and the ${rules.subjectLabel} ${names.map((name) => JSON.stringify(name)).join(' and ')} ` +
      `is claimed by ${String(services.length)} services: ${services.join(', ')}. ` +
      'Merge under "namespace" or "first-wins" to rename it, or rename it in the service.',
    ErrorCode.FED_MERGE_CONFLICT,
    undefined,
    { key, subject: rules.subjectLabel, services },
  );
}
