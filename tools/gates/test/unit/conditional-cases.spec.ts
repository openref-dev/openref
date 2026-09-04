import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CONDITIONAL_CASES,
  CONDITIONAL_DEPENDENCIES,
  conditionalCasesFailed,
  MACHINES,
  machineOf,
  probeDependency,
  reconcileConditionalCases,
  scanConditionalCases,
} from '../../src/lib/conditional-cases.js';
import type {
  ConditionalDependency,
  ConditionalGroup,
  FoundGroup,
} from '../../src/lib/conditional-cases.js';

/**
 * The register of cases that can silence themselves, and the rule that none may run nowhere.
 *
 * THE SUBJECT IS THE nginx CASE. It skipped on the workstation for want of the binary and ran on
 * CI, except that no CI run had happened on the working branch, so for two milestones it executed
 * on neither machine while the suite stayed green. Every case below is about telling that state
 * apart from a case that runs on both.
 *
 * EVERY RULE HERE IS SHOWN RED ON A PLANT rather than only green on the tree, because a
 * reconciliation that agrees with everything is the same green lie the register exists to end.
 */

const repoRoot = join(import.meta.dirname, '..', '..', '..', '..');

/** A dependency present on both machines, for cases about something other than coverage. */
function bothMachines(id: string): ConditionalDependency {
  return {
    id,
    description: `the ${id} thing`,
    probe: { kind: 'path', path: 'package.json' },
    runsOn: ['darwin-workstation', 'linux-runner'],
    evidence: 'written here for the case',
  };
}

/** A group in the register, defaulted so a case names only what it is about. */
function group(overrides: Partial<ConditionalGroup> = {}): ConditionalGroup {
  return {
    file: 'packages/x/test/unit/x.spec.ts',
    mechanism: 'it.skipIf',
    guard: '!present.thing',
    dependency: 'thing',
    cases: 1,
    ...overrides,
  };
}

/** The same group as the scanner would report it. */
function seen(overrides: Partial<FoundGroup> = {}): FoundGroup {
  return {
    file: 'packages/x/test/unit/x.spec.ts',
    mechanism: 'it.skipIf',
    guard: '!present.thing',
    cases: 1,
    lines: [10],
    ...overrides,
  };
}

/** Conditions naming a machine that has everything the dependencies name. */
function onDarwinWithEverything(
  dependencies: readonly ConditionalDependency[],
): Parameters<typeof reconcileConditionalCases>[1] {
  return {
    machine: 'darwin-workstation',
    present: new Map(dependencies.map((dependency) => [dependency.id, true])),
  };
}

describe('the register against the tree', () => {
  it('should account for every conditional group in the repository, in both directions', () => {
    // Given the sources as they are
    const found = scanConditionalCases(repoRoot);

    // When they are compared with the committed register
    const issues = reconcileConditionalCases(found, {
      machine: machineOf(process.platform),
      present: new Map(
        CONDITIONAL_DEPENDENCIES.map((dependency) => [
          dependency.id,
          probeDependency(dependency, repoRoot),
        ]),
      ),
    });

    // Then nothing is unregistered, stale, miscounted or contradicted by this machine
    expect(issues.filter((issue) => issue.level === 'error')).toEqual([]);
    expect(conditionalCasesFailed(issues)).toBe(false);
  });

  it('should find the nginx case this register exists for, still guarded and still registered', () => {
    // Given: the proof of absence asserts its subject is present first. The case is real, it is
    // guarded, and it is the one that ran nowhere.
    const found = scanConditionalCases(repoRoot);

    // When
    const nginx = found.find(
      (candidate) =>
        candidate.file === 'packages/static/test/integration/proxy-config-tools.spec.ts' &&
        candidate.guard.startsWith('nginx is not installed'),
    );

    // Then it is in the tree and the register says both machines run it
    expect(nginx).toBeDefined();
    const registered = CONDITIONAL_CASES.find((entry) => entry.dependency === 'nginx');
    expect(registered?.file).toBe('packages/static/test/integration/proxy-config-tools.spec.ts');
    const dependency = CONDITIONAL_DEPENDENCIES.find((entry) => entry.id === 'nginx');
    expect([...(dependency?.runsOn ?? [])].sort()).toEqual([...MACHINES].sort());
  });

  it('should count every case the register carries and match the tree exactly', () => {
    // Given
    const found = scanConditionalCases(repoRoot);

    // When
    const inTree = found.reduce((total, entry) => total + entry.cases, 0);
    const registered = CONDITIONAL_CASES.reduce((total, entry) => total + entry.cases, 0);

    // Then: a figure held by a case rather than remembered, so a new guard moves it
    expect(inTree).toBe(registered);
    expect(found).toHaveLength(CONDITIONAL_CASES.length);
  });

  it('should read a call at the start of a line and not one inside a string literal', () => {
    // Given: `static-suites.spec.ts` carries `it.skipIf(...)` inside a quoted fixture, which is
    // not a case and must not be registered as one
    const found = scanConditionalCases(repoRoot);

    // When
    const staticSuites = found.filter(
      (entry) => entry.file === 'tools/gates/test/unit/static-suites.spec.ts',
    );

    // Then only the two real guards are seen, at their real lines
    expect(staticSuites).toHaveLength(1);
    expect(staticSuites[0]?.lines).toEqual([577, 610]);
  });
});

describe('a guard covering neither machine', () => {
  it('should be an error, because a check that runs nowhere is text', () => {
    // Given a dependency on neither machine, which is exactly the nginx state for two milestones
    const nowhere: ConditionalDependency = {
      ...bothMachines('thing'),
      runsOn: [],
    };

    // When
    const issues = reconcileConditionalCases(
      [seen()],
      onDarwinWithEverything([nowhere]),
      [group()],
      [nowhere],
    );

    // Then
    expect(conditionalCasesFailed(issues)).toBe(true);
    expect(issues.map((issue) => issue.message).join('\n')).toContain('NEITHER machine');
  });

  it('should be told apart from one covering a single machine, which is a listed gap', () => {
    // Given a dependency on one machine only
    const oneMachine: ConditionalDependency = {
      ...bothMachines('thing'),
      runsOn: ['darwin-workstation'],
    };

    // When
    const issues = reconcileConditionalCases(
      [seen()],
      onDarwinWithEverything([oneMachine]),
      [group()],
      [oneMachine],
    );

    // Then it is printed by name and does not fail the run
    expect(conditionalCasesFailed(issues)).toBe(false);
    const gap = issues.find((issue) => issue.level === 'warning');
    expect(gap?.message).toContain('GAP thing');
    expect(gap?.message).toContain('never on linux-runner');
  });
});

describe('the register against the machine it is running on', () => {
  it('should fail when it claims this machine runs a case and the thing is not here', () => {
    // Given a register claiming darwin has it, and a machine that does not
    const claimed = bothMachines('thing');

    // When
    const issues = reconcileConditionalCases(
      [seen()],
      { machine: 'darwin-workstation', present: new Map([['thing', false]]) },
      [group()],
      [claimed],
    );

    // Then
    expect(conditionalCasesFailed(issues)).toBe(true);
    expect(issues.map((issue) => issue.message).join('\n')).toContain(
      'this machine does not have it',
    );
  });

  it('should fail when it records a gap that this machine disproves', () => {
    // Given a register saying darwin does not run it, on a darwin machine that does
    const understated: ConditionalDependency = {
      ...bothMachines('thing'),
      runsOn: ['linux-runner'],
    };

    // When
    const issues = reconcileConditionalCases(
      [seen()],
      { machine: 'darwin-workstation', present: new Map([['thing', true]]) },
      [group()],
      [understated],
    );

    // Then: a gap wider than the truth is still a wrong record
    expect(conditionalCasesFailed(issues)).toBe(true);
    expect(issues.map((issue) => issue.message).join('\n')).toContain('and this machine has it');
  });

  it('should say it verified no column on a platform that is neither machine', () => {
    // Given
    const dependency = bothMachines('thing');

    // When
    const issues = reconcileConditionalCases(
      [seen()],
      { machine: undefined, present: new Map() },
      [group()],
      [dependency],
    );

    // Then it says so rather than reporting the register as checked, and does not go red
    expect(conditionalCasesFailed(issues)).toBe(false);
    expect(issues.map((issue) => issue.message).join('\n')).toContain('no column was verified');
  });

  it('should fail on a dependency it could not probe rather than assume it is there', () => {
    // Given a probe result missing for the dependency
    const dependency = bothMachines('thing');

    // When
    const issues = reconcileConditionalCases(
      [seen()],
      { machine: 'darwin-workstation', present: new Map() },
      [group()],
      [dependency],
    );

    // Then the unprobed column is an error, never the answer that means success
    expect(conditionalCasesFailed(issues)).toBe(true);
    expect(issues.map((issue) => issue.message).join('\n')).toContain('its column is unverified');
  });

  it('should map the two platforms and nothing else', () => {
    // Given, When, Then
    expect(machineOf('darwin')).toBe('darwin-workstation');
    expect(machineOf('linux')).toBe('linux-runner');
    expect(machineOf('win32')).toBeUndefined();
  });
});

describe('a conditional group the register does not name', () => {
  it('should fail, because that is how the silence comes back', () => {
    // Given a guard in the tree with no register entry
    const dependency = bothMachines('thing');

    // When
    const issues = reconcileConditionalCases(
      [seen(), seen({ file: 'packages/y/test/unit/y.spec.ts', guard: '!present.other' })],
      onDarwinWithEverything([dependency]),
      [group()],
      [dependency],
    );

    // Then
    expect(conditionalCasesFailed(issues)).toBe(true);
    expect(issues.map((issue) => issue.message).join('\n')).toContain(
      'no entry of CONDITIONAL_CASES names it',
    );
  });

  it('should fail on a register entry the tree no longer has', () => {
    // Given
    const dependency = bothMachines('thing');

    // When
    const issues = reconcileConditionalCases(
      [],
      onDarwinWithEverything([dependency]),
      [group()],
      [dependency],
    );

    // Then
    expect(conditionalCasesFailed(issues)).toBe(true);
    expect(issues.map((issue) => issue.message).join('\n')).toContain('the tree has no such group');
  });

  it('should fail when a guard silences more cases than the register records', () => {
    // Given a guard that has grown from one case to two
    const dependency = bothMachines('thing');

    // When
    const issues = reconcileConditionalCases(
      [seen({ cases: 2, lines: [10, 20] })],
      onDarwinWithEverything([dependency]),
      [group()],
      [dependency],
    );

    // Then
    expect(conditionalCasesFailed(issues)).toBe(true);
    expect(issues.map((issue) => issue.message).join('\n')).toContain('the register says 1');
  });

  it('should fail on a group waiting on a dependency nothing declares', () => {
    // Given
    const dependency = bothMachines('thing');

    // When
    const issues = reconcileConditionalCases(
      [seen()],
      onDarwinWithEverything([dependency]),
      [group({ dependency: 'ghost' })],
      [dependency],
    );

    // Then
    expect(conditionalCasesFailed(issues)).toBe(true);
    expect(issues.map((issue) => issue.message).join('\n')).toContain(
      'which no dependency declares',
    );
  });

  it('should fail on a declared dependency no group waits on', () => {
    // Given two dependencies and one group
    const used = bothMachines('thing');
    const unused = bothMachines('spare');

    // When
    const issues = reconcileConditionalCases(
      [seen()],
      onDarwinWithEverything([used, unused]),
      [group()],
      [used, unused],
    );

    // Then
    expect(conditionalCasesFailed(issues)).toBe(true);
    expect(issues.map((issue) => issue.message).join('\n')).toContain(
      'spare is declared and no group waits on it',
    );
  });
});

describe('the probe', () => {
  it('should report absence for a binary that is not on this machine', () => {
    // Given a command no machine has
    const absent: ConditionalDependency = {
      ...bothMachines('absent'),
      probe: { kind: 'binary', command: 'openref-no-such-binary', args: ['--version'] },
    };

    // When, Then: a probe that cannot answer reports absence, which is what the guard does
    expect(probeDependency(absent, repoRoot)).toBe(false);
  });

  it('should report presence for a path that is in the checkout', () => {
    // Given, When, Then
    expect(probeDependency(bothMachines('here'), repoRoot)).toBe(true);
  });

  it('should report absence for a path that is not', () => {
    // Given
    const missing: ConditionalDependency = {
      ...bothMachines('gone'),
      probe: { kind: 'path', path: 'no/such/file.json' },
    };

    // When, Then
    expect(probeDependency(missing, repoRoot)).toBe(false);
  });
});
