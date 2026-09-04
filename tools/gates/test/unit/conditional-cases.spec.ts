import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CONDITIONAL_CASES,
  CONDITIONAL_DEPENDENCIES,
  conditionalCasesFailed,
  MACHINES,
  machineOf,
  PROBE_HANG_CATCHER_MS,
  PROBE_MEASURED_MAXIMUM_MS,
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
    present: new Map(dependencies.map((dependency) => [dependency.id, 'present'])),
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
      { machine: 'darwin-workstation', present: new Map([['thing', 'absent']]) },
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
      { machine: 'darwin-workstation', present: new Map([['thing', 'present']]) },
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

describe('a column nobody established', () => {
  /** A dependency measured on darwin, whose runner column no one could read. */
  function undeterminedOnLinux(): ConditionalDependency {
    return {
      ...bothMachines('thing'),
      runsOn: ['darwin-workstation'],
      undetermined: ['linux-runner'],
      evidence: 'the manifest was not readable from the machine that wrote this',
    };
  }

  it('should print it as undetermined and never as a gap, because the two are different facts', () => {
    // Given a dependency whose linux column is recorded as unestablished
    const dependency = undeterminedOnLinux();

    // When
    const issues = reconcileConditionalCases(
      [seen()],
      onDarwinWithEverything([dependency]),
      [group()],
      [dependency],
    );
    const printed = issues.map((issue) => issue.message).join('\n');

    // Then it is said in its own word, it is not a failure, and no line claims the case never runs
    // on linux, which is the assertion `runsOn` alone would have made for free
    expect(printed).toContain('UNDETERMINED thing');
    expect(printed).toContain('is not established');
    expect(printed).not.toContain('GAP thing');
    expect(printed).not.toContain('never on linux-runner');
    expect(conditionalCasesFailed(issues)).toBe(false);
  });

  it('should report what it measured when the run is on the machine nobody established', () => {
    // Given the same dependency, on the machine whose column is undetermined, present there
    const dependency = undeterminedOnLinux();

    // When
    const issues = reconcileConditionalCases(
      [seen()],
      { machine: 'linux-runner', present: new Map([['thing', 'present']]) },
      [group()],
      [dependency],
    );
    const printed = issues.map((issue) => issue.message).join('\n');

    // Then the measurement is in front of a reader with what to do about it, and the run that
    // honestly says it does not know is not the run that fails
    expect(printed).toContain('recorded UNDETERMINED on linux-runner');
    expect(printed).toContain('measured it as PRESENT');
    expect(conditionalCasesFailed(issues)).toBe(false);
  });

  it('should fail when one machine is recorded as both known and unestablished', () => {
    // Given a register that says both things about one column
    const dependency: ConditionalDependency = {
      ...bothMachines('thing'),
      runsOn: ['darwin-workstation', 'linux-runner'],
      undetermined: ['linux-runner'],
    };

    // When
    const issues = reconcileConditionalCases(
      [seen()],
      onDarwinWithEverything([dependency]),
      [group()],
      [dependency],
    );

    // Then
    expect(conditionalCasesFailed(issues)).toBe(true);
    expect(issues.map((issue) => issue.message).join('\n')).toContain(
      'both known to run it and undetermined',
    );
  });

  it('should still fail a dependency no machine is known to run, undetermined or not', () => {
    // Given the nginx class, wearing the new state: nothing has ever been shown to run it
    const dependency: ConditionalDependency = {
      ...bothMachines('thing'),
      runsOn: [],
      undetermined: ['linux-runner'],
    };

    // When
    const issues = reconcileConditionalCases(
      [seen()],
      onDarwinWithEverything([dependency]),
      [group()],
      [dependency],
    );

    // Then the rule this file exists for is untouched by the third state
    expect(conditionalCasesFailed(issues)).toBe(true);
    expect(issues.map((issue) => issue.message).join('\n')).toContain('it is on NEITHER machine');
  });

  it('should have been settled on the C# cases by the first run that could measure it', () => {
    // Given the committed register. `dotnet` is the one dependency that ever carried the third
    // state: it was written on 2026-09-04 from a machine that could not read the runner's software
    // list, and the `columns` job of run 33893185806 measured that column on the runner the same
    // day as SDK 10.0.400 at /usr/bin/dotnet.
    const dotnet = CONDITIONAL_DEPENDENCIES.find((entry) => entry.id === 'dotnet');

    // Then the subject is present before anything is claimed about the shape of the register, and
    // the column is written down rather than still being asked
    expect(dotnet).toBeDefined();
    expect([...(dotnet?.runsOn ?? [])].sort()).toEqual([...MACHINES].sort());
    expect(dotnet?.undetermined).toBeUndefined();

    // And nothing in the committed register is undetermined any more, which is this state working
    // rather than this state being unused: every rule about it below is held on a planted register
    expect(
      CONDITIONAL_DEPENDENCIES.filter((entry) => (entry.undetermined ?? []).length > 0).map(
        (entry) => entry.id,
      ),
    ).toEqual([]);

    // And the group it guards is still the C# half of the wire suite
    const guarded = CONDITIONAL_CASES.filter((entry) => entry.dependency === 'dotnet');
    expect(guarded.map((entry) => entry.file)).toEqual([
      'packages/samples/test/integration/tool-wire-equality.spec.ts',
    ]);
    expect(guarded[0]?.guard).toBe('!present.dotnet');
  });
});

describe('a probe that was killed before it answered', () => {
  /** A dependency whose binary is there and will not answer inside the wait it is given. */
  function sleeps(): ConditionalDependency {
    return {
      ...bothMachines('sleeper'),
      probe: { kind: 'binary', command: 'sh', args: ['-c', 'sleep 30'] },
    };
  }

  it('should be told apart from an absence, because one of the two measured nothing', () => {
    // Given: the proof of absence asserts its subject is present first. `sh` is on both machines
    // and answers when it is allowed to, so what the short wait changes is the answer and not the
    // machine.
    const runnable: ConditionalDependency = {
      ...bothMachines('sleeper'),
      probe: { kind: 'binary', command: 'sh', args: ['-c', 'exit 0'] },
    };
    expect(probeDependency(runnable, repoRoot, 30_000)).toBe('present');

    // When the same shell is asked for something it cannot finish inside the wait
    const killed = probeDependency(sleeps(), repoRoot, 250);

    // Then it is undetermined and not absent, because nothing about this machine was learned
    expect(killed).toBe('undetermined');
  });

  it('should still call a missing binary absent however short the wait is', () => {
    // Given a command no machine has, and the same 250 ms that turned the sleeper undetermined
    const gone: ConditionalDependency = {
      ...bothMachines('gone'),
      probe: { kind: 'binary', command: 'openref-no-such-binary', args: ['--version'] },
    };

    // When, Then: an absence is ENOENT and immediate, so a short wait cannot manufacture one
    expect(probeDependency(gone, repoRoot, 250)).toBe('absent');
  });

  it('should take the run red rather than agree with whatever the register says', () => {
    // Given a register that says this machine does NOT have it, and a probe that could not tell.
    // Before 2026-09-04 the probe reported absence here and this run went green on a column
    // nobody measured, which is the silent half of the defect that took CI red on Swift.
    const claimsAbsent: ConditionalDependency = {
      ...bothMachines('thing'),
      runsOn: ['linux-runner'],
    };

    // When
    const issues = reconcileConditionalCases(
      [seen()],
      { machine: 'darwin-workstation', present: new Map([['thing', 'undetermined']]) },
      [group()],
      [claimsAbsent],
    );

    // Then
    expect(conditionalCasesFailed(issues)).toBe(true);
    expect(issues.map((issue) => issue.message).join('\n')).toContain(
      'was killed before it answered',
    );
  });

  it('should report what it measured when the register already says nobody knows', () => {
    // Given a column recorded as unestablished and a probe that also could not establish it
    const dependency: ConditionalDependency = {
      ...bothMachines('thing'),
      runsOn: ['darwin-workstation'],
      undetermined: ['linux-runner'],
    };

    // When
    const issues = reconcileConditionalCases(
      [seen()],
      { machine: 'linux-runner', present: new Map([['thing', 'undetermined']]) },
      [group()],
      [dependency],
    );

    // Then the measurement is printed as what it was, which is nothing
    expect(issues.map((issue) => issue.message).join('\n')).toContain(
      'measured it as UNDETERMINED',
    );
  });

  it('should hold the wait it gives a binary to the margin it claims over what was measured', () => {
    // Given, the margin used to be a sentence, and a sentence cannot go red. The wait was 30,000
    // against a first `swift --version` measured at 57,992 ms on the runner, which is under half
    // the reading it was supposed to cover.

    // When, Then: an order of magnitude, which is what this repository uses for a hang catcher
    expect(PROBE_HANG_CATCHER_MS / PROBE_MEASURED_MAXIMUM_MS).toBeGreaterThanOrEqual(10);
  });
});

describe('the probe', () => {
  it('should report absence for a binary that is not on this machine', () => {
    // Given a command no machine has
    const absent: ConditionalDependency = {
      ...bothMachines('absent'),
      probe: { kind: 'binary', command: 'openref-no-such-binary', args: ['--version'] },
    };

    // When, Then: a binary that is not installed is an absence, which is what the guard does
    expect(probeDependency(absent, repoRoot)).toBe('absent');
  });

  it('should report presence for a path that is in the checkout', () => {
    // Given, When, Then
    expect(probeDependency(bothMachines('here'), repoRoot)).toBe('present');
  });

  it('should report absence for a path that is not', () => {
    // Given
    const missing: ConditionalDependency = {
      ...bothMachines('gone'),
      probe: { kind: 'path', path: 'no/such/file.json' },
    };

    // When, Then
    expect(probeDependency(missing, repoRoot)).toBe('absent');
  });
});
