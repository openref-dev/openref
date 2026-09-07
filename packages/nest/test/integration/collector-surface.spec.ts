/**
 * Every `@openref/core` type this package's public declaration names is re-exported from it.
 *
 * WHY THE RULE IS "EVERY", AND NOT "THE FOUR THE COLLECTOR CONTRACT USES". The review that found
 * this reported one type, `IRNodeRuntime`, from one signature. Reading the built declaration
 * instead showed the same omission across nine names and five signatures, so fixing what was
 * reported would have left the same defect for the next consumer to meet from a different
 * direction. SPEC 4 states the promise for both audiences a package has: a theme author installs
 * one package, and so does a collector author.
 *
 * WHY THE BUILT DECLARATION AND NOT THE SOURCE. `src/index.ts` says what this package intends to
 * export; `dist/index.d.ts` is what a consumer's compiler actually reads. A name that only the
 * source knows about is a name a consumer cannot use, which is the same argument
 * `packages/vue/test/integration/public-surface.spec.ts` makes for the theme side and the same one
 * `module-formats.spec.ts` makes about bundling. The list is re-derived here rather than repeated,
 * so a further name entering a public signature reddens instead of passing unnoticed.
 *
 * IT SAID NINE AND IT IS ELEVEN, AND THE CORRECTION CAME FROM THE ARTEFACT CHANGING UNDER IT. This
 * file's own rule is to measure the built declaration because it cannot be wrong about what a
 * consumer reads. It can, when the declaration itself is hiding part of the subject. While the
 * declaration kept `@openref/federation` as an external specifier, and so named a package no
 * consumer can install, the federation types were not inlined and `IRInfo` and
 * `IRRelationshipEndpointKind` never reached the import line this reads. Inlining the private
 * packages fixed the first defect and made the second visible: the same measurement returned
 * eleven. Both are reachable from types already re-exported, not from internals alone, so both are
 * the defect this file exists for: `IRDocument.info` is an `IRInfo` and `IRRelationship.fromKind`
 * is an `IRRelationshipEndpointKind`.
 *
 * IT IS TWELVE SINCE 2026-09-05, AND THE TWELFTH ARRIVED THE WAY THIS FILE PREDICTS THEY WILL.
 * `IRDiscoveryProblem` entered a public signature when `CollectorRegistry.problems` stopped
 * returning an inline pair of strings and started returning the IR shape, which is what let a
 * collector add an action and a detail to what it records. The list is derived, so nothing had to
 * remember: this case went red on the built declaration and the re-export followed.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const PACKAGE_ROOT = join(import.meta.dirname, '..', '..');
const DECLARATION = join(PACKAGE_ROOT, 'dist', 'index.d.ts');

/** Names imported from `@openref/core` anywhere in a declaration file. */
function coreImportsOf(declaration: string): string[] {
  const names = new Set<string>();

  for (const match of declaration.matchAll(/import\s*\{([^}]*)\}\s*from\s*'@openref\/core'/g)) {
    for (const part of (match[1] ?? '').split(',')) {
      const name = part
        .trim()
        .replace(/^type\s+/, '')
        .split(/\s+as\s+/)[0];
      if (name !== undefined && name !== '') names.add(name);
    }
  }

  return [...names].sort();
}

/** Names the declaration re-exports, whatever the syntax tsup emitted them in. */
function reExportedBy(declaration: string, names: readonly string[]): Set<string> {
  const exported = new Set<string>();

  for (const match of declaration.matchAll(/^export\s*(?:type\s*)?\{([^}]*)\}/gm)) {
    for (const part of (match[1] ?? '').split(',')) {
      const written = part.trim().split(/\s+as\s+/);
      const name = (written.length > 1 ? written[1] : written[0])?.trim();
      if (name !== undefined && name !== '') exported.add(name);
    }
  }

  return new Set(names.filter((name) => exported.has(name)));
}

/**
 * Lines naming the bare noun in a position that is syntax rather than prose.
 *
 * COMMENT LINES ARE DROPPED RATHER THAN PARSED AWAY, which is the rule `published-consumer.spec.ts`
 * states for module specifiers and the reason is the same here: the alternative is a second
 * TypeScript parser inside a test, to be wrong in independently of the first.
 *
 * @param text - A declaration file, or a single line when the method itself is under test
 * @returns The offending lines, trimmed, empty when none
 */
function bareNounLines(text: string): string[] {
  return text.split('\n').flatMap((line) => {
    const match = /\bcontentSecurityPolicy\b/.exec(line);
    if (match === null) return [];
    const before = line.slice(0, match.index).trimStart();

    return before.startsWith('//') || before.startsWith('*') || before.startsWith('/*')
      ? []
      : [line.trim()];
  });
}

describe('the published type surface of @openref/nest', () => {
  let declaration = '';

  beforeAll(() => {
    // A missing artifact is not a pass. This case is about what a consumer reads, and there is
    // nothing to read until the package is built.
    expect(
      existsSync(DECLARATION),
      'dist/index.d.ts is not built. Run "pnpm --filter @openref/nest run build" first',
    ).toBe(true);
    declaration = readFileSync(DECLARATION, 'utf8');
  });

  it('should name IR types from @openref/core in its own public signatures, before anything is proved absent', () => {
    // Given, the proof below is worth nothing unless the subject is there. A declaration that
    // imported no IR type at all would satisfy the re-export rule vacuously.
    // When
    const named = coreImportsOf(declaration);

    // Then
    expect(named.length).toBeGreaterThanOrEqual(9);
    expect(named).toContain('IRNodeRuntime');
    expect(named).toContain('IRNode');
  });

  it('should re-export every @openref/core type its public declaration names', () => {
    // Given
    const named = coreImportsOf(declaration);

    // When
    const reachable = reExportedBy(declaration, named);
    const unreachable = named.filter((name) => !reachable.has(name));

    // Then, SPEC 4: a collector author installs one package.
    expect(unreachable).toEqual([]);
  });

  it('should carry the four types the collector contract of SPEC 6.2 names in its own signatures', () => {
    // Given, these four are the contract's own: the return, the node, and the two the fact
    // factory is typed in. They are named rather than derived because the contract is frozen and
    // a derivation would follow it wherever it went.
    const contract = ['IRConfidence', 'IRFact', 'IRNode', 'IRNodeRuntime'];

    // When
    const reachable = reExportedBy(declaration, contract);

    // Then
    expect([...reachable].sort()).toEqual(contract);
  });

  it('should carry the policy builder a host is told to call, from the package a host installs', () => {
    // Given, `docs/guide/09-security.md` tells a host to send the header and hands them this
    // function. Until T064 it named `@openref/render`, which a host cannot install.
    // When
    const reachable = reExportedBy(declaration, ['buildContentSecurityPolicy']);

    // Then
    expect([...reachable]).toEqual(['buildContentSecurityPolicy']);
  });

  it('should not carry a name that says this package sets the policy', () => {
    // Given, the rule the CSP correction established: the host sets the policy and the product
    // makes its output compatible with one. A bare noun in an export list says the opposite.
    //
    // THE POSITION IS THE QUESTION, NOT THE MENTION, which is the same rule
    // `published-consumer.spec.ts` states for the package names the guide mentions, and it is here
    // for the same reason: since the declaration inlines the private packages, it carries the JSDoc
    // that records this very rename, and that comment names the old bare noun in order to say it
    // was wrong. A scan over every mention would refuse the record of the correction along with the
    // defect it corrects. So a line whose text before the match is a comment is prose, and only a
    // name in a declared or exported position counts.
    // When, and the method is falsified on two lines before it is trusted on the file, because a
    // filter that dropped everything would report a clean declaration exactly as this one does.
    const verb = reExportedBy(declaration, ['buildContentSecurityPolicy']);
    const wouldCatch = bareNounLines('declare const contentSecurityPolicy: (n: string) => string;');
    const wouldIgnore = bareNounLines(' * It was `contentSecurityPolicy`, a bare noun, and wrong.');

    // Then, the verb is in the export list, the noun is not in any position that is syntax, and the
    // sweep that says so can tell the two apart.
    expect([...verb]).toEqual(['buildContentSecurityPolicy']);
    expect(wouldCatch).toHaveLength(1);
    expect(wouldIgnore).toEqual([]);
    expect(bareNounLines(declaration)).toEqual([]);
  });
});
