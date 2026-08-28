import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyFixes } from '../../src/cli/application/services/fix.service';
import { decoratorFor } from '../../src/cli/domain/fix-plan';
import type { FixPlan, PlannedEdit } from '../../src/cli/domain/fix-plan';

/**
 * The half of `--fix` that opens files, and every refusal that stops it opening the wrong one.
 *
 * `--dry-run` AND `--fix` ARE ASSERTED TO BE THE SAME COMPUTATION HERE, not just to look alike.
 * The same plan is run twice against the same tree, once with `write` false and once with it true,
 * and the two edit lists are compared. SPEC 7.4 asks for the same edits in the same order with the
 * same provenance, and that is what this compares.
 */

const CONTROLLER = [
  "import { Controller, Get } from '@nestjs/common';",
  "import { ApiOperation } from '@nestjs/swagger';",
  '',
  "@Controller('orders')",
  'export class OrdersController {',
  '  @Get()',
  '  list(): string[] {',
  "    return ['ord_1'];",
  '  }',
  '}',
  '',
].join('\n');

let root = '';

/** One edit naming a file relative to the temporary root. */
function edit(file: string): PlannedEdit {
  const decorator = decoratorFor({ kind: 'operation-id', operationId: 'list' });
  if (decorator === undefined) throw new Error('the fixture asked for an unwritable assertion');

  return {
    rule: 'missing-operation-id',
    code: 'DX030',
    confidence: 'declared',
    subject: 'GET /orders',
    file,
    controller: 'OrdersController',
    handler: 'list',
    decorator,
  };
}

/** A plan of exactly the given edits and no skipped findings. */
function planOf(edits: readonly PlannedEdit[]): FixPlan {
  return { edits, skipped: [] };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'openref-fix-'));
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src/orders.controller.ts'), CONTROLLER, 'utf8');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('applyFixes', () => {
  it('should write the rewritten file when writing is asked for', async () => {
    // Given
    const plan = planOf([edit('src/orders.controller.ts')]);

    // When
    const run = await applyFixes(plan, { root, write: true });

    // Then
    expect(run.applied).toHaveLength(1);
    expect(run.written).toBe(true);
    const after = await readFile(join(root, 'src/orders.controller.ts'), 'utf8');
    expect(after).toContain("@ApiOperation({ operationId: 'list' })");
  });

  it('should leave the file untouched on a dry run while reporting the same edit', async () => {
    // Given
    const plan = planOf([edit('src/orders.controller.ts')]);

    // When
    const dry = await applyFixes(plan, { root, write: false });
    const onDisk = await readFile(join(root, 'src/orders.controller.ts'), 'utf8');
    const wet = await applyFixes(plan, { root, write: true });

    // Then
    expect(onDisk).toBe(CONTROLLER);
    expect(dry.written).toBe(false);
    expect(dry.applied).toEqual(wet.applied);
    expect(dry.files.map((file) => file.after)).toEqual(wet.files.map((file) => file.after));
  });

  it('should refuse a path that escapes the repository root rather than follow it', async () => {
    // Given
    const plan = planOf([edit('../outside.controller.ts')]);

    // When
    const run = await applyFixes(plan, { root, write: true });

    // Then
    expect(run.applied).toHaveLength(0);
    expect(run.left[0]?.reason).toBe('no-source-location');
  });

  it('should refuse a path that is not TypeScript, which is how the specification stays unwritten', async () => {
    // Given
    await writeFile(join(root, 'openapi.json'), '{}', 'utf8');
    const plan = planOf([edit('openapi.json')]);

    // When
    const run = await applyFixes(plan, { root, write: true });

    // Then
    expect(run.applied).toHaveLength(0);
    expect(run.left[0]?.detail).toContain('TypeScript');
    expect(await readFile(join(root, 'openapi.json'), 'utf8')).toBe('{}');
  });

  it('should say a named file is not in this repository rather than create it', async () => {
    // Given
    const plan = planOf([edit('src/absent.controller.ts')]);

    // When
    const run = await applyFixes(plan, { root, write: true });

    // Then
    expect(run.applied).toHaveLength(0);
    expect(run.left[0]?.reason).toBe('no-source-location');
  });

  it('should carry the planner own skips through beside the ones the rewriter added', async () => {
    // Given
    const plan: FixPlan = {
      edits: [edit('src/absent.controller.ts')],
      skipped: [
        {
          rule: 'security-drift',
          code: 'RT010',
          subject: 'GET /orders',
          reason: 'unconfigured-mapping',
          detail: 'no mapping',
        },
      ],
    };

    // When
    const run = await applyFixes(plan, { root, write: true });

    // Then
    expect(run.left.map((entry) => entry.reason)).toEqual([
      'unconfigured-mapping',
      'no-source-location',
    ]);
  });
});
