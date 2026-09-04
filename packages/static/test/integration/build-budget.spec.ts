import { arch, cpus, platform, totalmem } from 'node:os';
import { describe, expect, it } from 'vitest';
import { normalizeOpenApiDocument } from '@openref/core';
import { buildSite } from '../../src/index';
import { fixtureAssets, MemoryOutputStore } from '../mocks/documents';

/**
 * SPEC 20's static build budget: 1000 nodes on 4 cores in 60 seconds or less.
 *
 * THE MACHINE IS IN THE RECORD FROM THE FIRST COMMIT, which is what the `TX-CLOCK` amendment
 * asks of this threshold by name: an elapsed budget with no machine beside it is a number
 * nobody can compare with another number, and this one names a core count without naming a
 * processor. So every run prints where it ran, and a figure quoted from this suite is quoted
 * with its machine or not at all.
 *
 * WHAT THE BUDGET IS AND IS NOT ON THIS HARDWARE. Measured at T039 on the workstation named in
 * the printed line below: 1000 operations plan 2103 pages and the whole build finishes in about
 * 3 seconds, roughly twenty times inside the ceiling. At that distance the assertion is a hang
 * catcher rather than a latency budget, and it says so here rather than being read later as a
 * measurement that nearly failed. `prerender` is the precedent, and the same amendment is what
 * requires the distinction to be stated instead of left to be inferred.
 *
 * THE CORE COUNT IS PART OF THE BUDGET AND THIS BUILD USES ONE. SPEC 16.3 allows four; the
 * build is single process and sequential by choice, so a machine with four cores and a machine
 * with sixteen produce the same figure here. That makes the measurement conservative against
 * the budget rather than flattering, which is the direction a threshold should err in.
 *
 * AND SINCE T042 THE FIGURE CERTIFIES ONLY WHERE THE MACHINE IS DECLARED. T042's own task text asks
 * for the elapsed budget to be enforced in CI on a fixed runner size, "so the number means
 * something", and the paragraph above is the reason: a threshold stated for four cores, checked on
 * a machine nobody named, is a number with nothing to compare against. The CI job pins the runner
 * and sets `OPENREF_STATIC_BUDGET_CORES` to the size SPEC 20 states; this suite reads it and
 * refuses to certify against a machine of another size, naming both counts. Where the variable is
 * unset, on a workstation, the ceiling still runs as a hang catcher and the report says in so many
 * words that this run did not certify the SPEC 20 figure. A check that cannot establish a fact says
 * so; it does not default to the answer meaning success.
 *
 * AND SINCE THE MAINTAINER'S RULING OF 2026-09-04 THE ELAPSED BOUND ITSELF IS SPLIT THE SAME WAY,
 * BECAUSE `certificationOf` WAS COMPUTING A VERDICT AND ONLY PRINTING IT. The sentence above was
 * true of the report and false of the assertion: the 60,000 ms ceiling ran identically in both
 * modes, so a run that had already declared it was measuring a machine SPEC 20 does not describe
 * went on to enforce SPEC 20's number against it anyway. The readings say what that costs. In the
 * `static-build-budget` job of `ci.yml`, runner size declared and no coverage, the build measured
 * 15,155 and 15,604 ms and the job was green. Inside the shared `verify` coverage job, size
 * undeclared and V8 instrumentation active, the same build over the same document measured 56,370
 * to 80,358 ms and was over 60,000 on eight of ten readings: the same code, read through an
 * instrument that costs 3.7 to 5.3 times, reported as a SPEC 20 failure. That is a red gate saying
 * something untrue about the product, which is worse than a silent one.
 *
 * SO: WHERE THE RUN CERTIFIES, THE 60,000 CEILING STANDS EXACTLY AS IT WAS. No cap moved. Where it
 * does not certify, the elapsed check becomes {@link UNCERTIFIED_TRAP_MS}, a hang trap sized by
 * this repository's own margin over what the uncertified mode actually measures, and the run says
 * in the report that it did not certify and what it checked instead. It never passes quietly: the
 * printed line names the mode, and `should say which bound it enforced` below asserts that it does.
 */

/** The SPEC 20 ceiling, enforced where and only where the run certifies. */
const BUDGET_MS = 60_000;

/**
 * The margin this repository uses when a bound catches a hang rather than budgets a latency.
 *
 * An order of magnitude over the measured maximum. `packages/vue/test/integration/public-surface`
 * and `packages/theme-telltale/test/integration/corpus.spec.ts` both name and check it; the second
 * derives every corpus member's bound through it. It is applied here to the uncertified reading
 * only. It is NOT applied to {@link BUDGET_MS}, which is not a hang trap at all: 60,000 over a
 * certified maximum of 15,604 ms is 3.8 times, and that is the point of the split rather than an
 * oversight. A product ceiling is a promise about the product and is not derived from a reading.
 */
const MARGIN = 10;

/**
 * What the uncertified mode measures, on the runner, which is the only instrument that counts.
 *
 * Ten instrumented coverage runs on 2026-09-03 and 2026-09-04, four vCPU `ubuntu-latest`, Node
 * 22.22.2 and Node 24, over AMD EPYC 7763, 9V45 and 9V74 as the pool handed them out: 56,370 ms at
 * the low end and 80,358 ms at the high end. The certified job on the same day, same runner size,
 * no coverage, read 15,155 and 15,604 ms. On an Apple M3 Ultra workstation, 28 cores, recorded for
 * contrast and never as a bound, the build is about 3 seconds.
 */
const MEASURED_UNCERTIFIED_MAXIMUM_MS = 80_358;

/**
 * What an uncertified run enforces instead of the SPEC 20 ceiling.
 *
 * COMPUTED RATHER THAN WRITTEN DOWN, so the margin cannot drift away from the reading it claims.
 * 10 times 80,358 is 803,580 ms, 13 minutes 24 seconds. Nothing is tuned against it and nothing
 * should be: what has to fail against it is a build that did not finish, through a cycle, a wait
 * that should not exist or a walk that went quadratic. A build that finishes in ninety seconds
 * under instrumentation is not a defect and this bound is deliberately incapable of calling it one.
 *
 * IT IS ALSO WHY THE TEST TIMEOUT MOVES ON THIS PATH AND ONLY ON THIS PATH. Two reasons, and both
 * are arithmetic rather than preference. The old timeout of `BUDGET_MS * 2` is 120,000 ms against a
 * measured maximum of 80,358: 1.49 times, where this repository asks for 10, so the timeout was
 * itself under margin in the mode it was running in. And a trap the timeout kills first is a trap
 * that can never report, which is a check that exists in the file and not in the run. So the
 * timeout on this path is the trap plus one SPEC 20 ceiling of slack, and the assertion is
 * reachable in the window between them.
 */
const UNCERTIFIED_TRAP_MS = MARGIN * MEASURED_UNCERTIFIED_MAXIMUM_MS;

/** Nodes the budget is stated for. */
const NODES = 1000;

/** How the runner declares the size SPEC 20 states the budget for. */
const CORES_VARIABLE = 'OPENREF_STATIC_BUDGET_CORES';

/** What one run is allowed to conclude about the SPEC 20 figure. */
interface Certification {
  /** True when this machine is the one the budget is stated for. */
  readonly certifies: boolean;
  /** Why, in the words the report prints. */
  readonly reason: string;
}

/**
 * Whether this run may report its figure as the SPEC 20 budget.
 *
 * @param declared - The value of the runner size variable, absent on an undeclared machine
 * @param actual - Cores this machine has
 * @returns Whether the figure certifies, and the sentence saying why
 */
export function certificationOf(declared: string | undefined, actual: number): Certification {
  if (declared === undefined || declared.trim() === '') {
    return {
      certifies: false,
      reason:
        `${CORES_VARIABLE} is not set, so this run does not certify the SPEC 20 figure: the ` +
        'threshold is stated for four cores and this machine declared nothing. The ceiling below ' +
        'still runs, as a hang catcher',
    };
  }

  const expected = Number(declared);

  if (!Number.isInteger(expected) || expected <= 0) {
    return {
      certifies: false,
      reason: `${CORES_VARIABLE} is "${declared}", which is not a core count, so this run certifies nothing`,
    };
  }

  if (expected !== actual) {
    return {
      certifies: false,
      reason:
        `${CORES_VARIABLE} declares ${String(expected)} core(s) and this machine has ` +
        `${String(actual)}. The runner changed size, so the figure is from a machine the budget ` +
        'is not stated for',
    };
  }

  return {
    certifies: true,
    reason: `${String(actual)} cores, the size SPEC 20 states the budget for`,
  };
}

/** What a run enforces, which follows from whether it certifies and from nothing else. */
interface Enforcement {
  /** The elapsed value the run asserts against. */
  readonly boundMs: number;
  /** What vitest allows the case, which must sit above {@link boundMs} to leave it reachable. */
  readonly timeoutMs: number;
  /** What the report says this run checked, in the words it prints. */
  readonly sentence: string;
}

/**
 * The bound a run enforces, split by certification per the maintainer's ruling of 2026-09-04.
 *
 * @param certifies - Whether {@link certificationOf} said this machine is the one SPEC 20 names
 * @returns The bound, the timeout that keeps it reachable, and the sentence the report prints
 */
export function enforcementFor(certifies: boolean): Enforcement {
  if (certifies) {
    return {
      boundMs: BUDGET_MS,
      timeoutMs: BUDGET_MS * 2,
      sentence: `the SPEC 20 ceiling of ${String(BUDGET_MS)} ms, enforced as the product budget`,
    };
  }

  return {
    boundMs: UNCERTIFIED_TRAP_MS,
    timeoutMs: UNCERTIFIED_TRAP_MS + BUDGET_MS,
    sentence:
      `NOT the SPEC 20 ceiling. This run checked a hang trap of ${String(UNCERTIFIED_TRAP_MS)} ` +
      `ms, which is ${String(MARGIN)} times the ${String(MEASURED_UNCERTIFIED_MAXIMUM_MS)} ms ` +
      'maximum an uncertified run has measured. The SPEC 20 figure is unproven by this run and ' +
      'no reading taken here may be quoted as it',
  };
}

/** Where this figure was taken, printed with it. */
function machine(): string {
  const processors = cpus();
  return `${processors[0]?.model ?? 'unknown'}, ${String(processors.length)} cores, ${String(
    Math.round(totalmem() / 1024 ** 3),
  )} GB, ${platform()} ${arch()}`;
}

/** A document of {@link NODES} operations over a shared pool of schemas. */
function largeDocument(): ReturnType<typeof normalizeOpenApiDocument> {
  const paths: Record<string, unknown> = {};
  for (let index = 0; index < NODES; index += 1) {
    paths[`/things/${String(index)}/{id}`] = {
      get: {
        operationId: `thing${String(index)}`,
        summary: `Reads thing ${String(index)}`,
        description: `Returns thing ${String(index)} with its **fields**.`,
        tags: [`group${String(index % 20)}`],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          200: {
            description: 'ok',
            content: {
              'application/json': {
                schema: { $ref: `#/components/schemas/Thing${String(index % 50)}` },
              },
            },
          },
        },
      },
    };
  }

  const schemas: Record<string, unknown> = {};
  for (let index = 0; index < 50; index += 1) {
    schemas[`Thing${String(index)}`] = {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'integer' }, name: { type: 'string' } },
    };
  }

  return normalizeOpenApiDocument({
    openapi: '3.1.0',
    info: { title: 'Large', version: '1.0.0' },
    paths,
    components: { schemas },
  });
}

describe('certificationOf, which decides whether a figure is the SPEC 20 figure', () => {
  it('should certify only where the declared size is the size this machine has', () => {
    // Given the runner the CI job pins, declaring what SPEC 20 states
    // When
    const verdict = certificationOf('4', 4);

    // Then
    expect(verdict.certifies).toBe(true);
    expect(verdict.reason).toContain('SPEC 20 states the budget for');
  });

  it('should refuse to certify on a machine of another size, naming both counts', () => {
    // Given a runner that changed size under the job. The figure would still be inside the
    // ceiling and would no longer be a figure about the machine the budget names.
    // When
    const verdict = certificationOf('4', 16);

    // Then
    expect(verdict.certifies).toBe(false);
    expect(verdict.reason).toContain('declares 4 core(s) and this machine has 16');
  });

  it('should refuse to certify where nothing declared the size, rather than assuming it', () => {
    // Given a workstation, which is every run outside the job
    // When
    const unset = certificationOf(undefined, 12);
    const nonsense = certificationOf('four', 4);

    // Then
    expect(unset.certifies).toBe(false);
    expect(unset.reason).toContain('does not certify the SPEC 20 figure');
    expect(nonsense.certifies).toBe(false);
    expect(nonsense.reason).toContain('not a core count');
  });
});

describe('the bound a run enforces, which the certification decides', () => {
  it('should enforce the SPEC 20 ceiling unchanged where the run certifies', () => {
    // Given a run in the job that pins the runner
    // When
    const enforced = enforcementFor(true);

    // Then, the product ceiling and nothing else. This is the assertion that would go red if the
    // split were ever used to move the number the specification states.
    expect(enforced.boundMs).toBe(60_000);
    expect(enforced.sentence).toContain('SPEC 20 ceiling');
    expect(enforced.sentence).not.toContain('hang trap');
  });

  it('should say it is not certifying, rather than passing quietly, where the run does not', () => {
    // Given the shared coverage job, where the size is undeclared and the instrument costs 3.7 to
    // 5.3 times. The old behaviour here was to enforce 60,000 anyway and report a SPEC 20 failure
    // about an instrument. The new behaviour must not be the other error, a check that quietly
    // answers success because it could not answer at all.
    // When
    const enforced = enforcementFor(false);

    // Then, and the certified sentence is asserted present first, so that the absence below is a
    // reading and not an artefact of looking in an empty place.
    expect(enforcementFor(true).sentence).toContain('SPEC 20 ceiling');
    expect(enforced.sentence).toContain('NOT the SPEC 20 ceiling');
    expect(enforced.sentence).toContain('hang trap');
    expect(enforced.sentence).toContain('unproven by this run');
    expect(enforced.boundMs).not.toBe(60_000);
  });

  it('should hold the trap over the reading it was taken from, by the margin it claims', () => {
    // Given, the margin used to be a sentence in a comment in this repository and a sentence
    // cannot go red. Both the bound and the reading live here, so a run that measures past a tenth
    // of the trap reddens this and whoever finds it moves the number or changes the claim.

    // When, Then
    expect(UNCERTIFIED_TRAP_MS / MEASURED_UNCERTIFIED_MAXIMUM_MS).toBeGreaterThanOrEqual(MARGIN);

    // And the trap must sit under what vitest allows the case, in both modes, or it is a check
    // that lives in the file and never in the run.
    expect(enforcementFor(false).timeoutMs).toBeGreaterThan(enforcementFor(false).boundMs);
    expect(enforcementFor(true).timeoutMs).toBeGreaterThan(enforcementFor(true).boundMs);
  });

  it('should never let the uncertified path be the cheaper one to satisfy', () => {
    // Given, the failure mode of any split: a bound that certifies is stricter than one that does
    // not, so a machine that stops declaring its size must never buy itself an easier check
    // without saying so. It does say so, in the sentence above and in the printed report, and the
    // arithmetic that makes the trap looser is asserted here rather than assumed.

    // When, Then
    expect(enforcementFor(false).boundMs).toBeGreaterThan(enforcementFor(true).boundMs);
  });
});

/**
 * Read once, at collection, because vitest takes a case's timeout as an argument and not as a
 * value the body may choose later. Nothing between here and the run changes either input.
 */
const VERDICT = certificationOf(process.env[CORES_VARIABLE], cpus().length);

/** What this process will enforce, decided by the verdict above and by nothing else. */
const ENFORCED = enforcementFor(VERDICT.certifies);

describe('the static build budget of SPEC 20', () => {
  it(
    'should build 1000 nodes inside the bound its certification allows, with the machine in the record',
    async () => {
      // Given
      const document = largeDocument();
      const store = new MemoryOutputStore();
      expect(document.nodes.size).toBe(NODES);

      // When
      const started = Date.now();
      const report = await buildSite({ document, store, assets: fixtureAssets() });
      const elapsed = Date.now() - started;

      // Then
      const pages = report.rendered.length + report.carried.length;
      console.log(
        `static-build: ${String(NODES)} nodes, ${String(pages)} pages in ${String(elapsed)} ms ` +
          `of ${String(ENFORCED.boundMs)}, on ${machine()}. ` +
          `${VERDICT.certifies ? 'CERTIFIED' : 'NOT CERTIFIED'}: ${VERDICT.reason}. ` +
          `WHAT THIS RUN CHECKED: ${ENFORCED.sentence}`,
      );

      expect(pages).toBeGreaterThan(NODES);
      expect(elapsed).toBeLessThan(ENFORCED.boundMs);
    },
    ENFORCED.timeoutMs,
  );

  it('should refuse to run at all where the job declared a size this machine is not', () => {
    // Given the one case a printed sentence is not enough for: the job pins a runner, the runner
    // is a different size, and the elapsed assertion above would still pass and would still be
    // reported as the SPEC 20 figure. That is the state this whole mechanism exists to refuse, so
    // it is a failure rather than a note.
    const declared = process.env[CORES_VARIABLE];

    // When
    const verdict = certificationOf(declared, cpus().length);

    // Then, a machine with no declaration is a workstation and is allowed; a machine with a
    // declaration that does not match it is a job measuring something other than what it says
    expect(declared === undefined || declared.trim() === '' || verdict.certifies).toBe(true);
  });

  it('should have enforced the bound its own verdict names, in this process', () => {
    // Given, the two cases above prove the function and this one proves the wiring. The defect
    // being closed is exactly a verdict that was computed correctly and then not used, so a suite
    // that only exercised `enforcementFor` in isolation would be silent about the thing that
    // actually went wrong.

    // When, Then
    expect(ENFORCED).toEqual(enforcementFor(VERDICT.certifies));
    expect(ENFORCED.boundMs).toBe(VERDICT.certifies ? 60_000 : UNCERTIFIED_TRAP_MS);
  });
});
