import { describe, expect, it } from 'vitest';
import { MergeConflictError } from '@openref/core';
import {
  allocateUnique,
  escapeIdentifier,
  identifierKey,
  namespaceIdentifier,
  resolveNames,
} from '../../src/index';
import type { FederationConflictMode, NameClaim, NameSpaceRules } from '../../src/index';

/**
 * The policy of SPEC 15, on its own, away from any document.
 *
 * WHAT IS BEING PINNED HERE IS THAT `first-wins` KEEPS EVERYTHING. The reading where the later
 * service is discarded is the one this project cannot have, since the task's done-when is that
 * merging is lossless, so the case below asserts the count as well as the names.
 */

const RULES: NameSpaceRules<string> = {
  subjectLabel: 'schema',
  keyOf: (name) => identifierKey(name),
  namespace: (name, serviceId) => namespaceIdentifier(name, serviceId),
  escape: escapeIdentifier,
};

/** A claim of one service to one name. */
function claim(name: string, ...serviceIds: string[]): NameClaim<string> {
  return { name, serviceIds, subject: `${serviceIds.join('+')}:${name}` };
}

/** The resolved names, as `subject -> name`, which is what a caller builds its maps from. */
function resolved(claims: readonly NameClaim<string>[], mode: FederationConflictMode): string[] {
  return resolveNames(claims, mode, RULES).map((entry) => `${entry.subject} -> ${entry.name}`);
}

describe('resolveNames', () => {
  it('should leave an uncontested name alone under every mode', () => {
    // Given two services claiming different names
    const claims = [claim('Money', 'billing'), claim('Order', 'orders')];
    const modes: readonly FederationConflictMode[] = ['namespace', 'first-wins', 'fail'];

    // When each mode resolves them
    const results = modes.map((mode) => resolved(claims, mode));

    // Then nothing moves, because nothing was contested
    expect(results).toEqual([
      ['billing:Money -> Money', 'orders:Order -> Order'],
      ['billing:Money -> Money', 'orders:Order -> Order'],
      ['billing:Money -> Money', 'orders:Order -> Order'],
    ]);
  });

  it('should move every claimant under namespace', () => {
    // Given two services claiming one name
    const claims = [claim('Money', 'orders'), claim('Money', 'billing')];

    // When they are resolved under namespace
    const results = resolved(claims, 'namespace');

    // Then neither keeps the plain name
    expect(results).toEqual(['orders:Money -> orders_Money', 'billing:Money -> billing_Money']);
  });

  it('should give the plain name to the lowest service id under first-wins', () => {
    // Given the same claim written in the order that would give the wrong answer
    const claims = [claim('Money', 'orders'), claim('Money', 'billing')];

    // When they are resolved under first-wins
    const results = resolved(claims, 'first-wins');

    // Then the winner is the lowest id and not the first entry, and both survive
    expect(results).toEqual(['orders:Money -> orders_Money', 'billing:Money -> Money']);
  });

  it('should refuse under fail, naming the subject and every service', () => {
    // Given three services claiming one name
    const claims = [
      claim('Money', 'orders'),
      claim('Money', 'billing'),
      claim('Money', 'shipping'),
    ];

    // When they are resolved under fail
    const resolve = (): unknown => resolveNames(claims, 'fail', RULES);

    // Then the refusal says what it was and who wanted it
    expect(resolve).toThrow(MergeConflictError);
    expect(resolve).toThrow(/schema "Money"/);
    expect(resolve).toThrow(/billing, orders, shipping/);
  });

  it('should treat two spellings that fold to one file name as one claim', () => {
    // Given two services whose ids differ only by case, each of which builds cleanly on its own
    const claims = [claim('User', 'billing'), claim('user', 'orders')];

    // When they are resolved under namespace
    const results = resolved(claims, 'namespace');

    // Then both are moved, because a merged document holding both would not build at all
    expect(results).toEqual(['billing:User -> billing_User', 'orders:user -> orders_user']);
  });

  it('should keep a class that spans services on the plain name', () => {
    // Given one claim behind which two services stand, and one other name
    const claims = [claim('Money', 'billing', 'orders'), claim('Order', 'orders')];

    // When they are resolved
    const results = resolved(claims, 'namespace');

    // Then a deduplicated component keeps its name, which is the point of deduplicating it
    expect(results).toEqual(['billing+orders:Money -> Money', 'orders:Order -> Order']);
  });

  it('should report who contested a name', () => {
    // Given three services claiming one name
    const claims = [
      claim('Money', 'billing'),
      claim('Money', 'orders'),
      claim('Money', 'shipping'),
    ];

    // When they are resolved
    const results = resolveNames(claims, 'namespace', RULES);

    // Then each result names the others rather than a count
    expect(results.map((entry) => entry.contestedBy)).toEqual([
      ['orders', 'shipping'],
      ['billing', 'shipping'],
      ['billing', 'orders'],
    ]);
  });
});

describe('allocateUnique', () => {
  it('should move a name that prefixing made collide with another', () => {
    // Given the concatenation that is not injective, in a spelling a configuration can really
    // reach: a service id carries no underscore, so the two claimants are a service `a` whose node
    // is called `b_c` and a service `a-b` whose node is called `c` inside a navigation id, which is
    // the space where two prefixing schemes meet over a character the id alphabet does have. The
    // pair `a` and `a_b` the first version of this case named is unreachable: `a_b` fails
    // `isFederationServiceId`, so it would be refused before a merge began.
    const claims = [claim('a_b_c', 'a'), claim('a_b_c', 'a-b')];

    // When the node id space allocates them
    const results = allocateUnique(claims, RULES);

    // Then the second one is moved out of the way, and marked as having been
    expect(results.map((entry) => `${entry.name} ${String(entry.escaped)}`)).toEqual([
      'a_b_c false',
      'a_b_c_2 true',
    ]);
  });

  it('should keep escaping until the name is free, escaping the claimed name and not the tail', () => {
    // Given three claims to one name, and a service that really is called the first escape of it
    const claims = [claim('x', 'a'), claim('x', 'b'), claim('x_2', 'c'), claim('x', 'd')];

    // When they are allocated
    const results = allocateUnique(claims, RULES);

    // Then each lands somewhere free rather than overwriting what is there, and the escape is
    // always built from the name that was asked for, so the readable stem survives every attempt
    expect(results.map((entry) => entry.name)).toEqual(['x', 'x_2', 'x_2_2', 'x_3']);
  });

  it('should never call the namespacing rule, since nothing here is contested', () => {
    // Given a rule set whose namespacing would be visible if it ran
    const rules: NameSpaceRules<string> = {
      ...RULES,
      namespace: () => 'NAMESPACED',
    };

    // When two claims to one name are allocated
    const results = allocateUnique([claim('x', 'a'), claim('x', 'b')], rules);

    // Then the answer is the escape and not the policy
    expect(results.map((entry) => entry.name)).toEqual(['x', 'x_2']);
  });
});
