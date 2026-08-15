import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { IRDriftIssue, IRHealthCheck } from '@openref/core';
import { SPAWNED_PROCESS_TIMEOUT_MS } from '../../../../vitest.spawn-timeout.ts';

/**
 * The drift engine of SPEC 7, run against a booted application rather than a hand built document.
 *
 * WHAT A HAND BUILT DOCUMENT CANNOT TELL YOU IS WHETHER THE RULES FIRE ON ANYTHING REAL. Every
 * rule in `core` is tested against a fixture built to trigger it, which proves the rule reads what
 * it says it reads and proves nothing about whether an ordinary NestJS application produces the
 * shapes those fixtures describe. This file asks the opposite question: given a real controller, a
 * real guard and a real throttler, does the report say something true about them.
 *
 * THE EXAMPLE IS DELIBERATELY IMPERFECT AND THAT IS WHAT MAKES IT USEFUL HERE. It has a guard on
 * every route and no security scheme in its `DocumentBuilder`, which is exactly the silence
 * `security-drift` exists for, and it takes `@nestjs/swagger`'s generated operation ids, which is
 * what `missing-operation-id` exists for. Both are real drift in a real application, and the day
 * somebody fixes the example is the day these assertions have to be rewritten rather than deleted.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const example = join(repoRoot, 'examples', 'nest-minimal');

/** What the booted example says about its own health. */
interface Report {
  readonly score: number;
  readonly operationCount: number;
  readonly checks: readonly IRHealthCheck[];
  readonly drift: readonly IRDriftIssue[];
  readonly skipped: readonly { readonly collector: string; readonly reason: string }[];
}

/** The program run inside the example project, which asks the container rather than a route. */
const PROGRAM = `
import { createApp } from './dist/main.js';
import { OPENREF_REFERENCES } from '@openref/nest';

const app = await createApp('express');
const references = app.get(OPENREF_REFERENCES, { strict: false });
const document = references.all()[0].pass.document;
const health = document.health;

process.stdout.write(
  JSON.stringify({
    score: health.score,
    operationCount: health.operationCount,
    checks: health.checks,
    drift: health.drift,
    skipped: document.runtime?.skipped ?? [],
  }),
);

await app.close();
`;

/** The one boot, kept for the reason `runtime-facts.spec.ts` states beside its own. */
let cached: Report | undefined;

/**
 * Boots the example and reads its health report.
 *
 * @returns What the application said about itself
 */
function report(): Report {
  if (cached !== undefined) return cached;

  if (!existsSync(join(example, 'dist', 'main.js'))) {
    throw new Error('examples/nest-minimal is not built. Run pnpm build; a skip is not a pass');
  }

  const printed = execFileSync(process.execPath, ['--input-type=module', '-e', PROGRAM], {
    cwd: example,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  cached = JSON.parse(printed) as Report;

  return cached;
}

/**
 * Every finding one rule produced.
 *
 * @param found - The whole report
 * @param rule - The rule id
 * @returns Its findings, in report order
 */
function issues(found: Report, rule: string): readonly IRDriftIssue[] {
  return found.drift.filter((issue) => issue.rule === rule);
}

/**
 * One check of the report.
 *
 * @param found - The whole report
 * @param id - The check id, which is the rule id for every rule
 * @returns The check
 */
function check(found: Report, id: string): IRHealthCheck {
  const match = found.checks.find((candidate) => candidate.id === id);
  if (match === undefined) {
    throw new Error(
      `no ${id} check in the report. It has: ${found.checks.map((one) => one.id).join(', ')}`,
    );
  }

  return match;
}

describe('the health report, against the running example application', () => {
  it(
    'should reach the document a reader is served, with a score and a line per rule',
    { timeout: SPAWNED_PROCESS_TIMEOUT_MS },
    () => {
      // Given the example, which mounts through `setup` and picks the pass up from the container
      const found = report();

      // Then. THE REPORT BEING ON THE DOCUMENT IS THE ASSERTION, because everything downstream
      // reads it from there: the panel of T023, `doctor` of T037, and the agent surface of T058.
      expect(found.operationCount).toBe(8);
      expect(found.score).toBeGreaterThan(0);
      expect(found.score).toBeLessThan(100);
      expect(found.checks.map((one) => one.id)).toEqual([
        'runtime-collectors',
        'security-drift',
        'scope-drift',
        'ratelimit-undocumented',
        'stream-unspecified',
        'error-undocumented',
        'orphan-operation',
        'parameter-unread',
        'header-requiredness-drift',
        'status-drift',
        'missing-description',
        'missing-example',
        'missing-operation-id',
        'dto-field-undescribed',
      ]);
    },
  );

  it(
    'should report a guarded application with no security scheme as a silence on every route',
    { timeout: SPAWNED_PROCESS_TIMEOUT_MS },
    () => {
      // Given `@UseGuards(ScopesGuard)` on the controller and a DocumentBuilder with no scheme
      const found = report();
      const drift = issues(found, 'security-drift');

      // Then every route is a silence, which is the one bucket a fix mode may ever act on
      expect(drift).toHaveLength(found.operationCount);
      for (const issue of drift) {
        expect(issue.classification).toEqual({ bucket: 'silence' });
        expect(issue.runtimeValue).toContain('ScopesGuard');
        expect(issue.basis).toEqual({ kind: 'collected', confidence: 'derived' });
      }
      expect(check(found, 'security-drift')).toMatchObject({ passed: 0, total: 8 });
    },
  );

  it(
    'should name the handler in the operationId it suggests, from the source collector',
    { timeout: SPAWNED_PROCESS_TIMEOUT_MS },
    () => {
      // Given `@nestjs/swagger`'s generated ids, which are `OrdersController_list` and friends
      const found = report();
      const drift = issues(found, 'missing-operation-id');

      // Then the pair is read literally rather than worked out, so the finding is fixable
      expect(drift).toHaveLength(found.operationCount);
      expect(drift.map((issue) => issue.specValue)).toContain('OrdersController_list');
      expect(drift.every((issue) => issue.classification.bucket === 'silence')).toBe(true);
      expect(drift.some((issue) => issue.suggestion.includes("operationId: 'list'"))).toBe(true);
    },
  );

  it(
    'should stay quiet about everything the example does document',
    { timeout: SPAWNED_PROCESS_TIMEOUT_MS },
    () => {
      // Given a throttled route that documents 429, a stream that declares its item type, three
      // handlers whose `@ApiErrors` statuses all have responses, and eight paired routes
      const found = report();

      // Then. THIS IS THE HALF THAT MAKES THE OTHER HALF WORTH READING: a rule that never stays
      // quiet is noise, and a panel that always has work to show is one a reader stops opening.
      expect(issues(found, 'ratelimit-undocumented')).toEqual([]);
      expect(issues(found, 'stream-unspecified')).toEqual([]);
      expect(issues(found, 'error-undocumented')).toEqual([]);
      expect(issues(found, 'orphan-operation')).toEqual([]);
      expect(issues(found, 'missing-description')).toEqual([]);
      // The TX-COLLECTORS pair that examined and stayed quiet: the receipt's token header is
      // documented required, and create's explicit 201 is among its documented codes.
      expect(issues(found, 'header-requiredness-drift')).toEqual([]);
      expect(issues(found, 'status-drift')).toEqual([]);
      expect(check(found, 'orphan-operation')).toMatchObject({ passed: 8, total: 8 });
      expect(check(found, 'ratelimit-undocumented')).toMatchObject({ passed: 1, total: 1 });
      expect(check(found, 'header-requiredness-drift')).toMatchObject({ passed: 1, total: 1 });
      // Two since TX-SHAPES: create's explicit 201 and the payment route's explicit 202, each
      // among its documented codes.
      expect(check(found, 'status-drift')).toMatchObject({ passed: 2, total: 2 });
    },
  );

  it(
    'should report the six declarations the list handler never reads, and only those',
    { timeout: SPAWNED_PROCESS_TIMEOUT_MS },
    () => {
      // Given the list operation, which declares nine query parameters and a header and binds
      // four of them by name. The drift is real: the other five and the header promise
      // filtering and echoing that the handler does not perform.
      const found = report();
      const drift = issues(found, 'parameter-unread');

      // Then one finding, on the one operation whose declarations exceed its reads
      expect(drift).toHaveLength(1);
      const finding = drift[0];
      expect(finding?.runtimeValue).toContain('createdAfter');
      expect(finding?.runtimeValue).toContain('createdBefore');
      expect(finding?.runtimeValue).toContain('sort');
      expect(finding?.runtimeValue).toContain('page');
      expect(finding?.runtimeValue).toContain('perPage');
      expect(finding?.runtimeValue).toContain('X-Request-Id');
      expect(finding?.runtimeValue).not.toContain('currency');
      expect(finding?.runtimeValue).not.toContain('status');
      expect(finding?.runtimeValue).not.toContain('minAmount');
      expect(finding?.runtimeValue).not.toContain('maxAmount');

      // And the scan's conclusion is a contradiction at inferred: which side is wrong is a
      // person's call, and no fix mode ever touches it, per SPEC 7.1.
      expect(finding?.classification).toEqual({ bucket: 'contradiction' });
      expect(finding?.basis).toEqual({ kind: 'collected', confidence: 'inferred' });

      // And every operation with a scanned fact is in the denominator; the read one, `read`
      // with its bound id, examined and stayed quiet.
      const scanned = check(found, 'parameter-unread');
      expect(scanned.total).toBeGreaterThanOrEqual(2);
      expect(scanned.total - scanned.passed).toBe(1);
    },
  );

  it(
    'should keep a collector failure out of the drift list entirely',
    { timeout: SPAWNED_PROCESS_TIMEOUT_MS },
    () => {
      // Given the twelve collectors of the example, none of which declined
      const found = report();

      // Then. THE BOUNDARY SPEC 7 DRAWS, AND THE ONE THIS TASK COULD MOST EASILY HAVE BLURRED: a
      // collector that failed is an instrument failing, not two sides disagreeing, and a drift row
      // sends a reader to edit their own code. It is a check, and it is never a finding.
      expect(found.skipped).toEqual([]);
      expect(check(found, 'runtime-collectors')).toMatchObject({ passed: 12, total: 12 });
      expect(
        found.drift.every((issue) => issue.nodeId !== undefined || issue.schemaId !== undefined),
      ).toBe(true);
    },
  );
});
