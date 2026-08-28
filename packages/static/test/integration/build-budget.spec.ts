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
 */

/** The SPEC 20 ceiling. */
const BUDGET_MS = 60_000;

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

describe('the static build budget of SPEC 20', () => {
  it(
    'should build 1000 nodes inside 60 seconds, with the machine in the record',
    async () => {
      // Given
      const document = largeDocument();
      const store = new MemoryOutputStore();
      const verdict = certificationOf(process.env[CORES_VARIABLE], cpus().length);
      expect(document.nodes.size).toBe(NODES);

      // When
      const started = Date.now();
      const report = await buildSite({ document, store, assets: fixtureAssets() });
      const elapsed = Date.now() - started;

      // Then
      const pages = report.rendered.length + report.carried.length;
      console.log(
        `static-build: ${String(NODES)} nodes, ${String(pages)} pages in ${String(elapsed)} ms ` +
          `of ${String(BUDGET_MS)}, on ${machine()}. ` +
          `${verdict.certifies ? 'CERTIFIED' : 'NOT CERTIFIED'}: ${verdict.reason}`,
      );

      expect(pages).toBeGreaterThan(NODES);
      expect(elapsed).toBeLessThan(BUDGET_MS);
    },
    BUDGET_MS * 2,
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
});
