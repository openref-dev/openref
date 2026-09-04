/**
 * Where every case that can silence itself actually runs, and the rule that none may run nowhere.
 *
 * THIS EXISTS BECAUSE OF ONE CASE THAT NEVER EXECUTED ANYWHERE FOR TWO MILESTONES. The nginx
 * snippet in `packages/static/test/integration/proxy-config-tools.spec.ts` is guarded by a probe
 * for the binary. The workstation had no nginx, so it skipped there on every run; CI had nginx and
 * ran it, but no CI run had ever happened on the branch the work was on, so nobody looked. The
 * case first executed on the first push to CI and failed four times in a row on environment
 * assumptions nothing had ever exercised. Between the two machines a green suite was reporting on
 * a scaffold that had validated nothing.
 *
 * THE DEFECT IS NOT THE SKIP. A case that cannot determine its fact must say so, and `skipIf` is
 * the right idiom for that. The defect is that NOTHING ANYWHERE RECORDED WHERE THE CASE RAN, so a
 * guard covering neither machine was indistinguishable from one covering both. `skip-accounting.ts`
 * asks this question of the gates; this file asks it of the suites, which is where the nginx case
 * lived.
 *
 * WHAT THE REGISTER HOLDS AND WHAT IS PROBED, because the two halves have different lifetimes.
 * {@link CONDITIONAL_CASES} is a dated, evidenced statement about two machines, and only one of
 * them is ever running this code. So:
 *
 * - the set of guards is RE-DERIVED from the suites by {@link scanConditionalCases}, so a new
 *   conditional case that no one registered fails rather than joining the silence
 * - the column for the machine this run is on is PROBED, so a register claiming a dependency this
 *   machine does not have goes red here rather than being believed
 * - the column for the other machine is a committed fact with its evidence beside it, because
 *   nothing running here can read that machine
 * - a group whose two columns are both false is an ERROR: it is a check that exists only as text
 *
 * A GROUP THAT RUNS ON EXACTLY ONE MACHINE IS A LISTED GAP AND NOT A FAILURE, and the distinction
 * is the one T065 was told to make. Such a case has run somewhere, so it is not the nginx class;
 * but the machine it runs on is a single laptop nothing else checks, so it is printed by name and
 * counted on every run rather than left to be rediscovered.
 *
 * A COLUMN NOBODY ESTABLISHED IS A THIRD STATE AND NOT A NO. Added 2026-09-04 with the first
 * dependency whose runner column could not be read from the machine writing it down. Leaving such a
 * machine out of `runsOn` is not neutral: it prints a GAP asserting the case never runs there, and
 * a wrong absence is as much a false record as a wrong presence. See
 * {@link ConditionalDependency.undetermined}.
 *
 * AND THE SAME THIRD STATE BELONGS TO THE PROBE, WHICH IS WHAT THE FIRST RUN ON THE RUNNER FOUND.
 * `probeDependency` used to wait 30,000 ms and call everything else absence, and on 2026-09-04 it
 * reported the Swift toolchain missing from a machine that has it and had run the Swift wire cases
 * green ninety minutes earlier. The reading that settles it is in {@link PROBE_HANG_CATCHER_MS}:
 * the FIRST `swift --version` on a fresh runner costs between 18,451 and 57,992 ms because the
 * toolchain comes off a cold disk, and every call after it costs about 90 ms under the full load of
 * the suite. A wait of 30,000 sat inside that spread, so the same code was green on one runner and
 * red on the next. THE DEFECT WAS NOT THE WAIT ON ITS OWN. It was that a probe which had measured
 * nothing returned the same answer as a probe that had measured an absence, which is this file's
 * own rule turned on itself. A binary that is not installed answers ENOENT in 11 ms at worst,
 * measured 686 times over four runners under every load those runs produced; so absence is cheap
 * and certain, and anything killed before it answered is now {@link ProbeOutcome} `undetermined`
 * and goes red saying so.
 */

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

/** A machine this project's suites are known to run on. */
export type MachineId = 'darwin-workstation' | 'linux-runner';

/** Both of them, which is the set a group's coverage is measured against. */
export const MACHINES: readonly MachineId[] = ['darwin-workstation', 'linux-runner'];

/** How the presence of a dependency is established on the machine this code is running on. */
export type DependencyProbe =
  | { readonly kind: 'binary'; readonly command: string; readonly args: readonly string[] }
  | { readonly kind: 'path'; readonly path: string }
  | { readonly kind: 'case-insensitive-volume' };

/** Something a guarded case needs before it can execute. */
export interface ConditionalDependency {
  readonly id: string;

  /** What it is, printed beside the group. */
  readonly description: string;

  /** How this machine is asked whether it has it. */
  readonly probe: DependencyProbe;

  /**
   * The machines that have it.
   *
   * The entry for the machine a run is on is checked against {@link probeDependency}; the other
   * is a committed fact and carries its evidence in {@link ConditionalDependency.evidence}.
   */
  readonly runsOn: readonly MachineId[];

  /**
   * The machines whose column nobody has established, which is neither a yes nor a no.
   *
   * A THIRD STATE, ADDED 2026-09-04, AND IT EXISTS TO KEEP A GUESS OUT OF THE REGISTER. Every
   * `linux-runner` column here is read off the runner image manifest, and a slice that cannot read
   * that document has two dishonest options and no honest one: claiming the runner has it invents
   * evidence, and leaving it out of `runsOn` claims the runner does NOT have it, which is a
   * statement with the same standing and prints a GAP naming a machine nobody asked. So the column
   * is recorded as undetermined, the gap is printed as undetermined rather than as an absence, and
   * the first run on that machine measures it and says what it found.
   *
   * IT NEVER SUBSTITUTES FOR `runsOn`. A dependency with an empty `runsOn` is still the error this
   * file exists for, undetermined or not: a check nothing has ever been shown to run is a check
   * that exists as text. A machine may not appear in both lists.
   *
   * NOTHING CARRIES IT TODAY, AND THAT IS THE STATE WORKING RATHER THAN THE STATE BEING UNUSED.
   * `dotnet` was written with it on 2026-09-04 because the image software list was the only source
   * for a runner column and that document was not readable from here; the first run on the runner
   * measured the column the same day and it was written down, which is the sentence this field was
   * always going to end in. The state stays because the next dependency written from a machine
   * that cannot see the other one needs it, and `conditional-cases.spec.ts` holds every rule about
   * it on planted registers so that the absence of a carrier costs no coverage.
   */
  readonly undetermined?: readonly MachineId[];

  /** Where the claim about the machine this code is not running on comes from. */
  readonly evidence: string;
}

/**
 * The dependencies every guarded case in this repository waits on.
 *
 * THE LINUX COLUMN IS MEASURED ON THE RUNNER SINCE 2026-09-04, AND IT USED TO BE READ OFF THE
 * IMAGE MANIFEST. The old note said `ubuntu-latest` resolved to Ubuntu 24.04 image 20260823.283.1
 * and that its published software list was the source for every `linux-runner` entry. That
 * document was right about all twelve, which is the least interesting way this could have come
 * out and is still worth writing down; what was wrong was the standing of the claim, because a
 * list read once is not a measurement and nothing here could tell the two apart.
 *
 * WHAT MEASURED IT. `runner-column-study.yml`, run 33893185806 and run 33893701335 on branch
 * `page-bytes/slice-3-measurement`, four vCPU `ubuntu-latest`: the `columns` job runs this file's
 * own probe through `pnpm gates test-skips` and prints every column, and the `under-load` job runs
 * the same probes with no wait at all, first on a cold machine and then in a loop beside the whole
 * unit suite, 343 rounds over four runners. Both answers agree, and every version below was read
 * off that machine rather than off a web page.
 *
 * A SECOND INSTRUMENT AGREES AND IS NAMED, because a column measured by one probe is a column
 * measured by one probe. CI run 33874798247, the last green run before the register existed, ran
 * `pnpm run test:integration` on the runner and reported `tool-wire-equality.spec.ts` as 27 tests
 * with 6 skipped, and 10 skipped over the whole integration suite. Those two counts are only
 * possible with exactly this column: 5 for HTTPie plus 1 for the four tool case make the six, and
 * caddy, the folding volume and the two `ai-docs` cases make the other four. The wget, PowerShell,
 * Ruby, Swift and .NET cases ran there, on the runner, and sent their requests.
 */
export const CONDITIONAL_DEPENDENCIES: readonly ConditionalDependency[] = [
  {
    id: 'wget',
    description: 'the wget binary, which sends one of the SPEC 18 samples for real',
    probe: { kind: 'binary', command: 'wget', args: ['--version'] },
    runsOn: ['darwin-workstation', 'linux-runner'],
    evidence:
      'measured on the runner 2026-09-04 as GNU Wget 1.21.4 at /usr/bin/wget, and here the same ' +
      'day. Six wire cases ran on the runner in CI run 33874798247',
  },
  {
    id: 'httpie',
    description: 'the HTTPie binary `http`, which sends one of the SPEC 18 samples for real',
    probe: { kind: 'binary', command: 'http', args: ['--version'] },
    runsOn: ['darwin-workstation'],
    evidence:
      'measured absent on the runner 2026-09-04: not on PATH, and the probe answers ENOENT in ' +
      '11 ms at worst over 343 rounds beside a full suite, which is what an absence costs when it ' +
      'is real. Five of the six cases skipped in `tool-wire-equality.spec.ts` in CI run ' +
      '33874798247 are these',
  },
  {
    id: 'powershell',
    description: 'the PowerShell binary `pwsh`, which sends one of the SPEC 18 samples for real',
    probe: { kind: 'binary', command: 'pwsh', args: ['-NoProfile', '-Command', 'exit 0'] },
    runsOn: ['darwin-workstation', 'linux-runner'],
    evidence:
      'measured on the runner 2026-09-04 at /usr/bin/pwsh, apt package powershell 7.6.5-1.deb. ' +
      'Its first call costs 2,507 to 3,863 ms cold and about 180 ms warm',
  },
  {
    id: 'swift',
    description: 'the Swift toolchain, which compiles and runs one of the SPEC 18 samples',
    probe: { kind: 'binary', command: 'swift', args: ['--version'] },
    runsOn: ['darwin-workstation', 'linux-runner'],
    evidence:
      'measured on the runner 2026-09-04 as Swift 6.3.3 (swift-6.3.3-RELEASE), target ' +
      'x86_64-unknown-linux-gnu, at /usr/local/bin/swift. THIS COLUMN IS THE ONE THE FIRST CI RUN ' +
      'CALLED FALSE AND IT WAS NOT: the probe waited 30,000 ms and the first `swift --version` on ' +
      'a fresh runner costs 18,451 to 57,992 ms off a cold disk, so what was measured was the ' +
      'wait and not the machine. Its two wire cases ran on the runner in CI run 33874798247',
  },
  {
    id: 'ruby',
    description: 'the Ruby interpreter, which runs one of the SPEC 18 samples',
    probe: { kind: 'binary', command: 'ruby', args: ['--version'] },
    runsOn: ['darwin-workstation', 'linux-runner'],
    evidence:
      'measured on the runner 2026-09-04 as ruby 3.2.3 (2024-01-18 revision 52bb2ac0a6) ' +
      '[x86_64-linux-gnu] at /usr/bin/ruby. Its four wire cases ran on the runner in CI run ' +
      '33874798247',
  },
  {
    id: 'dotnet',
    description: 'the .NET SDK, which compiles and runs the C# sample as a file based application',
    probe: {
      kind: 'binary',
      command: 'sh',
      args: ['-c', 'DOTNET_CLI_TELEMETRY_OPTOUT=1 dotnet --version'],
    },
    runsOn: ['darwin-workstation', 'linux-runner'],
    evidence:
      'measured here 2026-09-04 as SDK 10.0.400 and measured on the runner the same day as SDK ' +
      '10.0.400 at /usr/bin/dotnet. THIS COLUMN WAS RECORDED UNDETERMINED AND IS NOW MEASURED, ' +
      'which is the whole of what that state is for: it was written when the image software list ' +
      'was the only source and that document was not readable from here, `ci.yml` still adds no ' +
      'setup-dotnet step, and the first run on linux settled it rather than a guess doing so. Its ' +
      'two wire cases ran on the runner in CI run 33874798247',
  },
  {
    id: 'four-tools-together',
    description:
      'wget, HTTPie, PowerShell and Swift at once, for the one case that compares all four',
    probe: { kind: 'binary', command: 'http', args: ['--version'] },
    runsOn: ['darwin-workstation'],
    evidence:
      'HTTPie is the only one of its four the runner does not have, measured 2026-09-04, so this ' +
      'group is exactly as covered as `httpie` and is probed by the same binary. The sentence ' +
      'this replaces called HTTPie "the weakest of its four" when Swift was believed absent too, ' +
      'and it is now one rather than two. It is the sixth case skipped in ' +
      '`tool-wire-equality.spec.ts` in CI run 33874798247',
  },
  {
    id: 'nginx',
    description: 'the nginx binary, which validates the generated snippet with `nginx -t`',
    probe: { kind: 'binary', command: 'nginx', args: ['-v'] },
    runsOn: ['darwin-workstation', 'linux-runner'],
    evidence:
      'measured on the runner 2026-09-04 as nginx/1.24.0 (Ubuntu) at /usr/sbin/nginx, apt ' +
      'package nginx 1.24.0-2ubuntu7.17. THIS IS THE CASE THIS FILE EXISTS FOR: it ran on ' +
      'neither machine for two milestones and reported nothing',
  },
  {
    id: 'caddy',
    description: 'the caddy binary, which validates the generated snippet with `caddy adapt`',
    probe: { kind: 'binary', command: 'caddy', args: ['version'] },
    runsOn: ['darwin-workstation'],
    evidence:
      'measured absent on the runner 2026-09-04: not on PATH, ENOENT in 9 ms at worst over 343 ' +
      'rounds, while nginx is there, so the two halves of this suite are not equally covered',
  },
  {
    id: 'case-insensitive-volume',
    description:
      'a volume that folds case, which is the only thing that can answer whether two names are ' +
      'one directory entry',
    probe: { kind: 'case-insensitive-volume' },
    runsOn: ['darwin-workstation'],
    evidence:
      'measured on the runner 2026-09-04 by writing `a` into a temporary directory and asking ' +
      'for `A`, which was not there. Mounting a folding volume is not something a checkout can do',
  },
  {
    id: 'demo-application-built',
    description: 'the nest-minimal example compiled to `dist/main.js` by `pnpm build`',
    probe: { kind: 'path', path: 'examples/nest-minimal/dist/main.js' },
    runsOn: ['darwin-workstation', 'linux-runner'],
    evidence:
      'measured on the runner 2026-09-04: 3,717 bytes at examples/nest-minimal/dist/main.js ' +
      'after the `pnpm run build` step ci.yml runs before both suite steps',
  },
  {
    id: 'ai-docs',
    description: "the maintainer's private documents, which no clone restores",
    probe: { kind: 'path', path: 'ai-docs/SPEC.md' },
    runsOn: ['darwin-workstation'],
    evidence:
      'measured absent on the runner 2026-09-04: `ls -d ai-docs` answers no such file or ' +
      'directory there. ai-docs/ is not tracked by this repository and ci.yml adds no step that ' +
      'fetches it, so ' +
      'every runner checkout is without it. This is the largest group in the register and the ' +
      'reason the committed projection of tools/gates/ai-docs-projection.json exists',
  },
];

/** One place in the suites where cases are silenced by a condition. */
export interface ConditionalGroup {
  /** Repository relative path of the suite. */
  readonly file: string;

  /** `it.skipIf`, `describe.skipIf`, `context.skip` and so on. */
  readonly mechanism: string;

  /** The guard expression, verbatim, or the opening of the skip reason for a context skip. */
  readonly guard: string;

  /** Which entry of {@link CONDITIONAL_DEPENDENCIES} decides whether it runs. */
  readonly dependency: string;

  /** How many cases this guard silences, held so that a new one under an old guard is seen. */
  readonly cases: number;
}

/**
 * Every conditional group in the suites, with the dependency each one waits on.
 *
 * DERIVED FROM THE TREE ON 2026-09-04 AND RE-DERIVED ON EVERY RUN. 61 cases over 22 groups over
 * 7 files. `scanConditionalCases` produces the same list from the sources, and the gate compares
 * the two in both directions, so this is a record that cannot go stale in silence.
 */
export const CONDITIONAL_CASES: readonly ConditionalGroup[] = [
  {
    file: 'packages/cli/test/integration/cli-binary.spec.ts',
    mechanism: 'it.skipIf',
    guard: '!existsSync(DEMO_ENTRY)',
    dependency: 'demo-application-built',
    cases: 1,
  },
  {
    file: 'packages/cli/test/integration/nest-application-adapter.spec.ts',
    mechanism: 'describe.skipIf',
    guard: '!existsSync(DEMO_ENTRY)',
    dependency: 'demo-application-built',
    cases: 1,
  },
  {
    file: 'packages/core/test/unit/rule-codes.spec.ts',
    mechanism: 'it.skipIf',
    guard: '!HAVE_SPEC',
    dependency: 'ai-docs',
    cases: 1,
  },
  {
    file: 'packages/samples/test/integration/tool-wire-equality.spec.ts',
    mechanism: 'it.skipIf',
    guard: '!present.dotnet',
    dependency: 'dotnet',
    cases: 2,
  },
  {
    file: 'packages/samples/test/integration/tool-wire-equality.spec.ts',
    mechanism: 'it.skipIf',
    guard: '!present.httpie',
    dependency: 'httpie',
    cases: 5,
  },
  {
    file: 'packages/samples/test/integration/tool-wire-equality.spec.ts',
    mechanism: 'it.skipIf',
    guard: '!present.powershell',
    dependency: 'powershell',
    cases: 6,
  },
  {
    file: 'packages/samples/test/integration/tool-wire-equality.spec.ts',
    mechanism: 'it.skipIf',
    guard: '!present.ruby',
    dependency: 'ruby',
    cases: 4,
  },
  {
    file: 'packages/samples/test/integration/tool-wire-equality.spec.ts',
    mechanism: 'it.skipIf',
    guard: '!present.swift',
    dependency: 'swift',
    cases: 2,
  },
  {
    file: 'packages/samples/test/integration/tool-wire-equality.spec.ts',
    mechanism: 'it.skipIf',
    guard: '!present.wget',
    dependency: 'wget',
    cases: 6,
  },
  {
    file: 'packages/samples/test/integration/tool-wire-equality.spec.ts',
    mechanism: 'it.skipIf',
    guard: '!present.wget || !present.httpie || !present.powershell || !present.swift',
    dependency: 'four-tools-together',
    cases: 1,
  },
  {
    file: 'packages/static/test/integration/fold-on-disk.spec.ts',
    mechanism: 'context.skip',
    guard: 'this volume is case sensitive',
    dependency: 'case-insensitive-volume',
    cases: 1,
  },
  {
    file: 'packages/static/test/integration/proxy-config-tools.spec.ts',
    mechanism: 'context.skip',
    guard: 'caddy is not installed on this machine',
    dependency: 'caddy',
    cases: 1,
  },
  {
    file: 'packages/static/test/integration/proxy-config-tools.spec.ts',
    mechanism: 'context.skip',
    guard: 'nginx is not installed on this machine',
    dependency: 'nginx',
    cases: 1,
  },
  {
    file: 'tools/gates/test/integration/gates.spec.ts',
    mechanism: 'it.skipIf',
    guard: '!HAVE_AI_DOCS',
    dependency: 'ai-docs',
    cases: 2,
  },
  {
    file: 'tools/gates/test/unit/build-manifest.spec.ts',
    mechanism: 'it.skipIf',
    guard: '!HAVE_AI_DOCS',
    dependency: 'ai-docs',
    cases: 3,
  },
  {
    file: 'tools/gates/test/unit/claims.spec.ts',
    mechanism: 'it.skipIf',
    guard: '!HAVE_AI_DOCS',
    dependency: 'ai-docs',
    cases: 5,
  },
  {
    file: 'tools/gates/test/unit/events-suites.spec.ts',
    mechanism: 'it.skipIf',
    guard: '!aiDocsPresent(repoRoot)',
    dependency: 'ai-docs',
    cases: 2,
  },
  {
    file: 'tools/gates/test/unit/federation-suites.spec.ts',
    mechanism: 'it.skipIf',
    guard: '!aiDocsPresent(repoRoot)',
    dependency: 'ai-docs',
    cases: 2,
  },
  {
    file: 'tools/gates/test/unit/m6-suites.spec.ts',
    mechanism: 'it.skipIf',
    guard: '!aiDocsPresent(repoRoot)',
    dependency: 'ai-docs',
    cases: 3,
  },
  {
    file: 'tools/gates/test/unit/m7-suites.spec.ts',
    mechanism: 'it.skipIf',
    guard: '!aiDocsPresent(repoRoot)',
    dependency: 'ai-docs',
    cases: 5,
  },
  {
    file: 'tools/gates/test/unit/projection.spec.ts',
    mechanism: 'it.skipIf',
    guard: '!HAVE_AI_DOCS',
    dependency: 'ai-docs',
    cases: 5,
  },
  {
    file: 'tools/gates/test/unit/static-suites.spec.ts',
    mechanism: 'it.skipIf',
    guard: '!aiDocsPresent(repoRoot)',
    dependency: 'ai-docs',
    cases: 2,
  },
];

/** The modifiers that stop a case from running or from being believed. */
const SILENCING_MODIFIERS = ['skip', 'only', 'todo', 'skipIf', 'runIf', 'fails'] as const;

/** What a scan found in the sources, before it is compared with the register. */
export interface FoundGroup {
  readonly file: string;
  readonly mechanism: string;
  readonly guard: string;
  readonly cases: number;
  readonly lines: readonly number[];
}

/**
 * The substring of a context skip's message that identifies it, which is its first clause.
 *
 * A CONTEXT SKIP HAS NO GUARD EXPRESSION TO QUOTE. The condition is an `if` several lines above
 * the call, so what identifies the group is the reason it prints. Taking the opening rather than
 * the whole message keeps the register readable and still fails when a reason is rewritten, which
 * is the point: a changed reason is a changed decision.
 *
 * @param message - The full argument of the `skip(...)` call
 * @returns Its first clause, without quotes
 */
function skipReasonOpening(message: string): string {
  return (
    message
      .replace(/\s+/gu, ' ')
      .trim()
      .replace(/^['"`]/u, '')
      .split(/,|['"`]/u)[0]
      ?.trim()
      .slice(0, 60) ?? ''
  );
}

/**
 * The text between one `(` and the `)` that closes it.
 *
 * @param source - The file
 * @param openIndex - Index of the opening parenthesis
 * @returns The enclosed text, or undefined when nothing closes it
 */
function balancedArgument(source: string, openIndex: number): string | undefined {
  let depth = 0;

  for (let index = openIndex; index < source.length; index += 1) {
    if (source[index] === '(') depth += 1;
    else if (source[index] === ')') {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex + 1, index);
    }
  }

  return undefined;
}

/** Spec files under a directory, ignoring build output and dependencies. */
function specFilesUnder(root: string, repoRoot: string, found: string[] = []): string[] {
  let entries: readonly { name: string; isDirectory: () => boolean }[];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return found;
  }

  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;

    const absolute = join(root, entry.name);
    if (entry.isDirectory()) specFilesUnder(absolute, repoRoot, found);
    else if (entry.name.endsWith('.spec.ts')) {
      found.push(relative(repoRoot, absolute).replace(/\\/gu, '/'));
    }
  }

  return found.sort();
}

/**
 * Every conditional group in the suites, read off the sources.
 *
 * IT MATCHES AT THE START OF A LINE ON PURPOSE. `tools/gates/test/unit/static-suites.spec.ts`
 * carries `"it.skipIf(!HAVE_AI_DOCS)(...)"` inside a string literal as a fixture for another
 * check, and a scan that matched anywhere would register a case that does not exist. A real call
 * begins its line after indentation; the fixture has a quote in front of it.
 *
 * @param repoRoot - Absolute repository root
 * @returns One entry per file and guard, sorted by file then guard
 */
export function scanConditionalCases(repoRoot: string): FoundGroup[] {
  const groups = new Map<
    string,
    { file: string; mechanism: string; guard: string; lines: number[] }
  >();

  const record = (file: string, mechanism: string, guard: string, line: number): void => {
    const key = `${file} | ${mechanism} | ${guard}`;
    const existing = groups.get(key) ?? { file, mechanism, guard, lines: [] };
    existing.lines.push(line);
    groups.set(key, existing);
  };

  const files = [
    ...specFilesUnder(join(repoRoot, 'packages'), repoRoot),
    ...specFilesUnder(join(repoRoot, 'tools'), repoRoot),
  ];

  for (const file of files) {
    let source: string;
    try {
      source = readFileSync(join(repoRoot, file), 'utf8');
    } catch {
      continue;
    }

    const chain = new RegExp(
      String.raw`^[ \t]*(it|test|describe|suite)\.(${SILENCING_MODIFIERS.join('|')})\b`,
      'gmu',
    );

    let match = chain.exec(source);
    while (match !== null) {
      const line = source.slice(0, match.index).split('\n').length;
      const modifier = match[2] ?? '';
      let guard = modifier;

      if (modifier === 'skipIf' || modifier === 'runIf') {
        const open = source.indexOf('(', match.index + match[0].length - 1);
        guard = balancedArgument(source, open)?.trim() ?? modifier;
      }

      record(file, `${match[1] ?? ''}.${modifier}`, guard, line);
      match = chain.exec(source);
    }

    const contextSkip = /^[ \t]*skip\(/gmu;
    match = contextSkip.exec(source);
    while (match !== null) {
      const line = source.slice(0, match.index).split('\n').length;
      const open = source.indexOf('(', match.index);
      record(file, 'context.skip', skipReasonOpening(balancedArgument(source, open) ?? ''), line);
      match = contextSkip.exec(source);
    }
  }

  return [...groups.values()]
    .map((group) => ({ ...group, cases: group.lines.length, lines: [...group.lines] }))
    .sort(
      (left, right) => left.file.localeCompare(right.file) || left.guard.localeCompare(right.guard),
    );
}

/**
 * What one probe found out about the machine it ran on, including that it found nothing out.
 *
 * THE THIRD MEMBER IS THE WHOLE POINT AND IT IS NOT A CONVENIENCE. `absent` is a measurement: the
 * machine was asked and said no. `undetermined` is the absence of a measurement, and folding it
 * into `absent` is how this file's own rule gets broken from the inside, because a register that
 * cannot tell a measured no from an unanswered question is the state the nginx case was in.
 */
export type ProbeOutcome = 'present' | 'absent' | 'undetermined';

/**
 * How long a version probe waits before what it has is a hang rather than an answer.
 *
 * IT WAS 30,000 AND 30,000 WAS INSIDE THE SPREAD OF A REAL ANSWER, WHICH IS THE DEFECT. Measured
 * by the `under-load` job of `runner-column-study.yml` in run 33893701335, four vCPU
 * `ubuntu-latest` on image ubuntu24 20260831.293.1, with the machine beside every reading: the
 * FIRST `swift --version` after a checkout, an install and a build costs 57,992 ms on an AMD EPYC
 * 7763, 38,434 ms on another EPYC 7763, 32,662 ms on an EPYC 9V74 and 18,451 ms on another EPYC
 * 9V74. The Swift toolchain comes off a cold disk. Every call after that one costs 90 to 171 ms
 * even with the whole unit suite running beside it on the same four vCPU, 343 rounds over the four
 * runners, so what the wait was measuring was the disk and not contention and not the machine. The
 * same unchanged code was therefore green on one runner and red on the next, which is exactly what
 * happened on 2026-09-04 between CI run 33884072380 and the `columns` job an hour later.
 *
 * THE MARGIN IS THE ONE THIS REPOSITORY USES, an order of magnitude over the measured maximum,
 * which is what `packages/vue/test/integration/public-surface.spec.ts`,
 * `tools/gates/test/integration/published-surface-agreement.spec.ts`,
 * `tools/browser-budget/test/unit/specification.spec.ts` and
 * `packages/theme-telltale/test/integration/corpus.spec.ts` all name and derive from. Ten times
 * 57,992 is 579,920, rounded up to the next whole ten seconds. `conditional-cases.spec.ts` holds
 * this number to that margin over that reading, so the two cannot drift apart in a comment.
 *
 * IT IS A HANG CATCHER AND NOT A BUDGET, and nothing should be tuned against it. Reaching it means
 * a binary that never returns, and what the reconciliation then says is that the column is
 * unverified. THE OTHER DIRECTION COSTS NOTHING, which is why a number this large is affordable: a
 * binary that is not installed answers ENOENT in 11 ms at worst under any load, measured 686 times,
 * so an absence never waits and only a hang does.
 *
 * `SPAWNED_PROCESS_TIMEOUT_MS` IS NOT REUSED HERE AND THE REASON IS ARITHMETIC. It is 180,000, and
 * against this measured maximum that is 3.1 times rather than ten, so adopting it would be adopting
 * a number derived from a different measurement and quietly claiming this one's margin.
 */
export const PROBE_HANG_CATCHER_MS = 580_000;

/** The heaviest reading a probe that answered has produced on the runner, per the constant above. */
export const PROBE_MEASURED_MAXIMUM_MS = 57_992;

/**
 * Whether a failed spawn was killed rather than answered.
 *
 * A KILLED CHILD MEASURED NOTHING. `execFileSync` reports its own timeout as `ETIMEDOUT` with
 * `signal` set to SIGTERM, and the kernel's out of memory killer arrives the same way with
 * SIGKILL; in both cases the process was stopped from outside before it could say anything about
 * itself. A missing binary is the opposite: `ENOENT` with no signal at all, and immediately.
 *
 * @param error - Whatever `execFileSync` threw
 * @returns True when the child was stopped by a signal instead of exiting
 */
function killedBeforeAnswering(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;

  const signal: unknown = (error as { signal?: unknown }).signal;

  return typeof signal === 'string' && signal.length > 0;
}

/**
 * What this machine says about what a dependency names.
 *
 * IT NEVER ANSWERS `present` WHEN IT COULD NOT TELL, AND SINCE 2026-09-04 IT NEVER ANSWERS
 * `absent` EITHER. A probe that ran and exited non zero, or found nothing to run, reports
 * `absent`, because the guard in the suite behaves the same way: what a suite does on a failed
 * probe is skip, so that is what "does not have it" means here. A probe that was killed before it
 * could answer reports `undetermined`, because the suite's guard has no wait at all and would have
 * kept waiting, so the two would have disagreed about a machine while looking like agreement.
 *
 * @param dependency - The dependency to look for
 * @param repoRoot - Absolute repository root, for path probes
 * @param waitMs - How long a binary probe may take, for the cases that plant a hang
 * @returns What was found, or that nothing was
 */
export function probeDependency(
  dependency: ConditionalDependency,
  repoRoot: string,
  waitMs: number = PROBE_HANG_CATCHER_MS,
): ProbeOutcome {
  const probe = dependency.probe;

  if (probe.kind === 'path') return existsSync(join(repoRoot, probe.path)) ? 'present' : 'absent';

  if (probe.kind === 'binary') {
    try {
      execFileSync(probe.command, [...probe.args], { stdio: 'ignore', timeout: waitMs });

      return 'present';
    } catch (error) {
      return killedBeforeAnswering(error) ? 'undetermined' : 'absent';
    }
  }

  let directory = '';
  try {
    directory = mkdtempSync(join(tmpdir(), 'openref-fold-'));
    writeFileSync(join(directory, 'a'), '');

    return statSync(join(directory, 'A'), { throwIfNoEntry: false }) === undefined
      ? 'absent'
      : 'present';
  } catch {
    // A TEMPORARY DIRECTORY THAT COULD NOT BE MADE OR WRITTEN ANSWERS NOTHING ABOUT CASE FOLDING.
    return 'undetermined';
  } finally {
    if (directory !== '') rmSync(directory, { recursive: true, force: true });
  }
}

/**
 * Which of the two machines this run is on, or undefined when it is neither.
 *
 * A THIRD PLATFORM IS NOT AN ERROR AND IS NOT A PASS EITHER. On Windows or anywhere else the
 * probe half of the check cannot be attributed to a column, so it is not run, and the gate says
 * that it did not run rather than reporting the register as verified.
 *
 * @param platform - `process.platform`
 * @returns The machine id, or undefined
 */
export function machineOf(platform: string): MachineId | undefined {
  if (platform === 'darwin') return 'darwin-workstation';
  if (platform === 'linux') return 'linux-runner';

  return undefined;
}

/** One thing wrong with, or worth saying about, the register. */
export interface ConditionalIssue {
  readonly level: 'error' | 'warning' | 'info';
  readonly message: string;
}

/** What the reconciliation is told about the machine it is on. */
export interface ConditionalConditions {
  /** Which machine, or undefined when the probe half cannot be attributed. */
  readonly machine: MachineId | undefined;

  /** What the probe said about each dependency id here. Missing ids are treated as unprobed. */
  readonly present: ReadonlyMap<string, ProbeOutcome>;
}

/**
 * Compares the register with the tree and with this machine.
 *
 * @param found - What `scanConditionalCases` read off the sources
 * @param conditions - Which machine this is and what it has
 * @param register - The committed groups, defaulting to the committed ones
 * @param dependencies - The committed dependencies, defaulting to the committed ones
 * @returns Findings, errors first in severity but in register order
 */
export function reconcileConditionalCases(
  found: readonly FoundGroup[],
  conditions: ConditionalConditions,
  register: readonly ConditionalGroup[] = CONDITIONAL_CASES,
  dependencies: readonly ConditionalDependency[] = CONDITIONAL_DEPENDENCIES,
): ConditionalIssue[] {
  const issues: ConditionalIssue[] = [];
  const byId = new Map(dependencies.map((entry) => [entry.id, entry]));
  const keyOf = (group: { file: string; mechanism: string; guard: string }): string =>
    `${group.file} | ${group.mechanism} | ${group.guard}`;

  const registered = new Map(register.map((group) => [keyOf(group), group]));
  const scanned = new Map(found.map((group) => [keyOf(group), group]));

  for (const group of found) {
    if (registered.has(keyOf(group))) continue;

    issues.push({
      level: 'error',
      message:
        `${group.file}:${group.lines.join(',')} silences ${String(group.cases)} case(s) with ` +
        `${group.mechanism} on \`${group.guard}\`, and no entry of CONDITIONAL_CASES names it. ` +
        'A case that can stop running has to say where it runs instead, because a guard covering ' +
        'neither machine looks exactly like one covering both',
    });
  }

  for (const group of register) {
    const match = scanned.get(keyOf(group));

    if (match === undefined) {
      issues.push({
        level: 'error',
        message:
          `CONDITIONAL_CASES names ${group.mechanism} on \`${group.guard}\` in ${group.file} ` +
          'and the tree has no such group. The register is describing a case that is not there',
      });
      continue;
    }

    if (match.cases !== group.cases) {
      issues.push({
        level: 'error',
        message:
          `${group.file} silences ${String(match.cases)} case(s) on \`${group.guard}\` and the ` +
          `register says ${String(group.cases)}. Lines ${match.lines.join(',')}`,
      });
    }
  }

  for (const dependency of dependencies) {
    const groups = register.filter((group) => group.dependency === dependency.id);
    const cases = groups.reduce((total, group) => total + group.cases, 0);

    if (groups.length === 0) {
      issues.push({
        level: 'error',
        message: `dependency ${dependency.id} is declared and no group waits on it`,
      });
      continue;
    }

    // THE RULE THIS FILE EXISTS FOR. Both columns false is a check nothing anywhere executes.
    if (dependency.runsOn.length === 0) {
      issues.push({
        level: 'error',
        message:
          `${String(cases)} case(s) wait on ${dependency.id} and it is on NEITHER machine, so ` +
          'they have never run anywhere. A check that exists only as text is a failure or a ' +
          'listed gap, never a quiet pass',
      });
      continue;
    }

    // A MACHINE IN BOTH LISTS IS A CONTRADICTION AND NOT A PREFERENCE. `runsOn` says it runs there
    // and `undetermined` says nobody knows, and a register that says both says nothing.
    const unknown = dependency.undetermined ?? [];
    const contradictory = unknown.filter((machine) => dependency.runsOn.includes(machine));
    if (contradictory.length > 0) {
      issues.push({
        level: 'error',
        message:
          `${dependency.id} lists ${contradictory.join(' and ')} as both known to run it and ` +
          'undetermined, which are two different records of one column',
      });
    }

    const missing = MACHINES.filter(
      (machine) => !dependency.runsOn.includes(machine) && !unknown.includes(machine),
    );

    if (missing.length > 0) {
      issues.push({
        level: 'warning',
        message:
          `GAP ${dependency.id}: ${String(cases)} case(s) over ${String(groups.length)} group(s) ` +
          `run on ${dependency.runsOn.join(' and ')} ONLY, never on ${missing.join(' and ')}. ` +
          `${dependency.description}. Evidence: ${dependency.evidence}`,
      });
    }

    // UNDETERMINED IS PRINTED AS ITS OWN WORD AND NEVER FOLDED INTO THE GAP ABOVE. A gap is a
    // measured absence a reader can act on; this is the absence of a measurement, and calling it a
    // gap would put a fact in front of a reader that nobody established.
    if (unknown.length > 0) {
      issues.push({
        level: 'warning',
        message:
          `UNDETERMINED ${dependency.id}: ${String(cases)} case(s) over ` +
          `${String(groups.length)} group(s); whether ${unknown.join(' and ')} run(s) them is not ` +
          `established. ${dependency.description}. Evidence: ${dependency.evidence}`,
      });
    }

    if (missing.length === 0 && unknown.length === 0) {
      issues.push({
        level: 'info',
        message: `${dependency.id}: ${String(cases)} case(s) over ${String(groups.length)} group(s), on both machines`,
      });
    }
  }

  for (const group of register) {
    if (byId.has(group.dependency)) continue;

    issues.push({
      level: 'error',
      message: `${group.file} waits on ${group.dependency}, which no dependency declares`,
    });
  }

  // THE HALF THE OTHER MACHINE CANNOT BE ASKED FOR. Whichever machine this is, its own column is
  // measured now, so a register that has gone stale about the machine in front of it goes red
  // here rather than being taken on trust.
  if (conditions.machine === undefined) {
    issues.push({
      level: 'warning',
      message:
        'this platform is neither of the two machines in the register, so no column was ' +
        'verified by probe here. The comparison with the tree above still holds',
    });

    return issues;
  }

  const machine = conditions.machine;
  for (const dependency of dependencies) {
    const claimed = dependency.runsOn.includes(machine);
    const actual = conditions.present.get(dependency.id);

    if (actual === undefined) {
      issues.push({
        level: 'error',
        message: `${dependency.id} was not probed on ${machine}, so its column is unverified`,
      });
      continue;
    }

    // THE RUN THAT CAN SETTLE AN UNDETERMINED COLUMN SAYS WHAT IT FOUND AND DOES NOT GO RED. The
    // register honestly records that nobody established this column, so failing the run that first
    // measures it would turn an honest record into a broken build on a correct tree. It is a
    // warning carrying the measurement, which is what a maintainer needs to write the column down.
    if ((dependency.undetermined ?? []).includes(machine)) {
      issues.push({
        level: 'warning',
        message:
          `${dependency.id} is recorded UNDETERMINED on ${machine} and this run measured it as ` +
          `${actual.toUpperCase()}. Record that column in CONDITIONAL_DEPENDENCIES and take the ` +
          'machine out of `undetermined`',
      });
      continue;
    }

    // A PROBE THAT WAS KILLED MEASURED NOTHING, AND SAYING SO IS THE POINT OF THE WHOLE FILE. This
    // is the branch that did not exist on 2026-09-04, when a `swift --version` stopped at 30,000 ms
    // was reported as an absence and took the register red about a machine that has Swift. The
    // error is loud in this direction and would have been SILENT in the other: a dependency the
    // register already records as absent would have been agreed with by a probe that never ran to
    // completion, and the run would have gone green on a column nobody measured.
    if (actual === 'undetermined') {
      issues.push({
        level: 'error',
        message:
          `the probe for ${dependency.id} on ${machine} was killed before it answered, so this ` +
          'run measured nothing about that column. It is not an absence: a binary that is not ' +
          'installed answers ENOENT immediately under any load, so a probe that had to be stopped ' +
          'found something and could not finish asking it',
      });
      continue;
    }

    if (claimed && actual === 'absent') {
      issues.push({
        level: 'error',
        message:
          `the register says ${machine} runs the case(s) waiting on ${dependency.id} and this ` +
          'machine does not have it. Either it went away here, in which case those cases are ' +
          'now silent on this machine and the register has to say so, or the claim was never ' +
          `true. ${dependency.description}`,
      });
    }

    if (!claimed && actual === 'present') {
      issues.push({
        level: 'error',
        message:
          `the register says ${machine} does NOT run the case(s) waiting on ${dependency.id} ` +
          'and this machine has it. The gap recorded against this dependency is narrower than ' +
          'the register claims, and a gap wider than the truth is still a wrong record',
      });
    }
  }

  return issues;
}

/** Whether the reconciliation found something that has to go red. */
export function conditionalCasesFailed(issues: readonly ConditionalIssue[]): boolean {
  return issues.some((issue) => issue.level === 'error');
}
