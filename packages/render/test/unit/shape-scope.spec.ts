import { describe, expect, it } from 'vitest';
import { normalizeOpenApiDocument, type IRSchema } from '@openref/core';
import { shapeRowsOf } from '../../src/page/domain/shape-rows';
import {
  deriveControls,
  drawnPathsOf,
  type ShapeControl,
  type ShapeInputControl,
  type ShapePatternControl,
  type ShapeTupleControl,
} from '../../src/page/domain/shape-form';
import { conditionsOf, readCondition } from '../../src/page/domain/shape-conditions';

/**
 * The four defects of the T039 amendment, which the filing calls one decision rather than four.
 *
 * Each case first asserts the subject is present, then asserts what the scope changed about it,
 * because a case that only looked for the new sentence would pass on a form that drew nothing.
 */

/** A document whose conditions and key shapes sit where the filing says they were mishandled. */
function scopedSchemas(): Readonly<Record<string, IRSchema>> {
  const document = normalizeOpenApiDocument({
    openapi: '3.1.0',
    info: { title: 'Scope', version: '1.0.0' },
    paths: {},
    components: {
      schemas: {
        // A ROOT `oneOf` WHOSE BRANCHES DERIVE AT THE ROOT PREFIX. `Deep` below is the same
        // construct one level down, where the filing measured it silently never holding.
        Order: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['a', 'b'] },
            amount: { type: 'integer' },
          },
          required: ['kind'],
          oneOf: [
            { $ref: '#/components/schemas/BranchA' },
            { $ref: '#/components/schemas/BranchB' },
          ],
          discriminator: {
            propertyName: 'kind',
            mapping: { a: '#/components/schemas/BranchA', b: '#/components/schemas/BranchB' },
          },
        },
        BranchA: {
          type: 'object',
          properties: {
            kind: { const: 'a' },
            aOnly: { type: 'string' },
            guarded: { type: 'string' },
          },
          required: ['kind'],
          // Tests a field of the instance it constrains: legitimate, and it has to keep working.
          if: { properties: { amount: { exclusiveMinimum: 100 } }, required: ['amount'] },
          then: { required: ['guarded'] },
        },
        BranchB: {
          type: 'object',
          properties: {
            kind: { const: 'b' },
            bOnly: { type: 'string' },
            alsoGuarded: { type: 'string' },
          },
          required: ['kind'],
          // Tests a field only the SIBLING branch draws: unanswerable here, and it used to read
          // as satisfiable through a value the hidden branch left in the map.
          if: { properties: { aOnly: { const: 'yes' } }, required: ['aOnly'] },
          then: { required: ['alsoGuarded'] },
        },
        // A CONDITION NAMING A FIELD NOTHING ANYWHERE DRAWS.
        Ghost: {
          type: 'object',
          properties: { present: { type: 'string' }, hostage: { type: 'string' } },
          if: { properties: { absent: { const: 'x' } }, required: ['absent'] },
          then: { required: ['hostage'] },
        },
        // BOTH KINDS OF KEY ON ONE OBJECT, AT THE ROOT AND UNDER A MEMBER.
        Mixed: {
          type: 'object',
          properties: {
            declared: { type: 'string' },
            bag: {
              type: 'object',
              properties: { known: { type: 'string' } },
              patternProperties: { '^x-[a-z]+$': { type: 'string' } },
            },
          },
          patternProperties: { '^root-[a-z]+$': { type: 'string' } },
        },
        // AN OPEN TUPLE AND A CLOSED ONE, SIDE BY SIDE.
        Tuples: {
          type: 'object',
          properties: {
            open: {
              type: 'array',
              prefixItems: [
                { type: 'number', title: 'lat' },
                { type: 'number', title: 'lon' },
              ],
            },
            closed: {
              type: 'array',
              prefixItems: [
                { type: 'number', title: 'lat' },
                { type: 'number', title: 'lon' },
              ],
              items: false,
            },
          },
        },
      },
    },
  });

  return Object.fromEntries(document.schemas);
}

const schemas = scopedSchemas();

/** The input control at one path, for a case that asserts something about it. */
function inputAt(controls: readonly ShapeControl[], path: string): ShapeInputControl | undefined {
  return controls.find(
    (control): control is ShapeInputControl => control.kind === 'input' && control.path === path,
  );
}

describe('a condition naming a field the form does not draw', () => {
  it('should report the condition rather than reading as false forever', () => {
    // Given
    const controls = deriveControls('Ghost', schemas, {});

    // When
    const hostage = inputAt(controls, '/hostage');

    // Then
    expect(hostage).toBeDefined();
    expect(hostage?.requiredness).toBe('conditional');
    expect(hostage?.conditionActive).toBe(false);
    expect(hostage?.conditionUndrawn).toBe(
      'absent is not drawn here, so this condition can never hold.',
    );
  });

  it('should say so in the reading half row as well as in the form', () => {
    // Given
    const rows = shapeRowsOf('Ghost', schemas, '/docs');

    // When
    const hostage = rows.find((row) => row.name === 'hostage');

    // Then
    expect(hostage).toBeDefined();
    expect(hostage?.requiredness).toBe('conditional');
    expect(hostage?.when).toContain('required only when absent = x');
    expect(hostage?.when).toContain('absent is not drawn here, so this condition can never hold.');
  });

  it('should leave a condition over a field the instance does draw untouched', () => {
    // Given
    const rows = shapeRowsOf('Order', schemas, '/docs');

    // When
    const guarded = rows.find((row) => row.name === 'guarded');

    // Then
    expect(guarded).toBeDefined();
    expect(guarded?.requiredness).toBe('conditional');
    expect(guarded?.when).toBe('required only when amount > 100');
    expect(guarded?.when).not.toContain('does not draw');
  });
});

describe('a value under a hidden branch', () => {
  it('should not satisfy a condition declared in a visible one', () => {
    // Given: branch A is chosen, its own field is filled, then branch B is chosen. The map
    // keeps the value under `/aOnly`, which is the promise that switching loses nothing.
    const onA = deriveControls('Order', schemas, { '/kind': 'a' });
    expect(inputAt(onA, '/aOnly')).toBeDefined();

    const values = { '/kind': 'b', '/aOnly': 'yes' };

    // When
    const onB = deriveControls('Order', schemas, values);
    const alsoGuarded = inputAt(onB, '/alsoGuarded');

    // Then
    expect(inputAt(onB, '/aOnly')).toBeUndefined();
    expect(alsoGuarded).toBeDefined();
    expect(alsoGuarded?.conditionActive).toBe(false);
    expect(alsoGuarded?.conditionUndrawn).toContain('aOnly');
  });

  it('should keep the value in the map, so the branch is still what it was', () => {
    // Given
    const values = { '/kind': 'b', '/aOnly': 'yes' };

    // When
    const backOnA = deriveControls('Order', schemas, { ...values, '/kind': 'a' });

    // Then
    expect(inputAt(backOnA, '/aOnly')).toBeDefined();
  });

  it('should still hold a condition over a field the visible branch shares', () => {
    // Given
    const values = { '/kind': 'a', '/amount': '500' };

    // When
    const controls = deriveControls('Order', schemas, values);
    const guarded = inputAt(controls, '/guarded');

    // Then
    expect(guarded).toBeDefined();
    expect(guarded?.conditionActive).toBe(true);
    expect(guarded?.conditionUndrawn).toBeUndefined();
  });
});

describe('an object declaring both properties and patternProperties', () => {
  it('should draw both in the filling half, at the member and at the root', () => {
    // Given
    const controls = deriveControls('Mixed', schemas, {});

    // When
    const patterns = controls.filter(
      (control): control is ShapePatternControl => control.kind === 'pattern',
    );

    // Then
    expect(inputAt(controls, '/declared')).toBeDefined();
    expect(inputAt(controls, '/bag/known')).toBeDefined();
    expect(patterns.map((control) => control.patterns.join())).toEqual([
      '^x-[a-z]+$',
      '^root-[a-z]+$',
    ]);
  });

  it('should draw both in the reading half, at the member and at the root', () => {
    // Given
    const rows = shapeRowsOf('Mixed', schemas, '/docs');

    // When
    const names = rows.map((row) => `${row.kind}:${row.name}`);

    // Then
    expect(names).toContain('field:declared');
    expect(names).toContain('field:bag');
    expect(names).toContain('pattern:^x-[a-z]+$');
    // THE ROOT PATTERN IS THE HALF THAT WAS MISSING. Both walkers reached a pattern only
    // through a member of `properties`, so a schema declaring keys by pattern at its own root
    // showed none of them.
    expect(names).toContain('pattern:^root-[a-z]+$');
  });

  it('should leave the nested object`s own fields to the schema page, as this half always has', () => {
    // Given
    const rows = shapeRowsOf('Mixed', schemas, '/docs');

    // When
    const bag = rows.find((row) => row.name === 'bag');
    const known = rows.find((row) => row.name === 'known');

    // Then: the reading half is selective by design and links out rather than repeating
    // structure. What it owes a reader here is that the declared keys exist and where to see
    // them, which is the type words and the link, not a second copy of the schema tree.
    expect(known).toBeUndefined();
    expect(bag?.type).toBe('object, declared keys and keys by pattern');
  });

  it('should name both kinds of key in the type of the object that has both', () => {
    // Given
    const rows = shapeRowsOf('Mixed', schemas, '/docs');

    // When
    const bag = rows.find((row) => row.name === 'bag');

    // Then
    expect(bag?.type).toBe('object, declared keys and keys by pattern');
  });
});

describe('a tuple whose tail is open', () => {
  it('should read as open rather than identically to a closed one', () => {
    // Given
    const rows = shapeRowsOf('Tuples', schemas, '/docs');

    // When
    const open = rows.find((row) => row.name === 'open');
    const closed = rows.find((row) => row.name === 'closed');

    // Then
    expect(open?.when).toBe('prefixItems: lat, lon; open: items beyond the tuple are allowed');
    expect(closed?.when).toBe('prefixItems: lat, lon; no items beyond the tuple');
  });

  it('should carry the openness on the control the filling half draws', () => {
    // Given
    const controls = deriveControls('Tuples', schemas, {});

    // When
    const tuples = controls.filter(
      (control): control is ShapeTupleControl => control.kind === 'tuple',
    );

    // Then
    expect(tuples.map((control) => `${control.label}:${String(control.closed)}`)).toEqual([
      'open:false',
      'closed:true',
    ]);
  });
});

describe('the scope itself', () => {
  it('should be the paths of every control a derivation draws', () => {
    // Given
    const controls = deriveControls('Mixed', schemas, { '/bag/#0/key': '' });

    // When
    const drawn = drawnPathsOf(controls);

    // Then
    expect(drawn.has('/declared')).toBe(true);
    expect(drawn.has('/bag/known')).toBe(true);
    expect(drawn.has('/bag/#0/key')).toBe(true);
    expect(drawn.has('/bag/#0/value')).toBe(true);
    expect(drawn.has('/nothing')).toBe(false);
  });

  it('should read a condition as undrawn only when its field is outside the scope', () => {
    // Given
    const ghost = schemas.Ghost?.normalized ?? {};
    const condition = conditionsOf(ghost)[0] ?? { words: '', clauses: [], requires: [] };
    const values = { '/absent': 'x' };

    // When
    const withoutScope = readCondition(condition, values, '', null);
    const withScope = readCondition(condition, values, '', new Set(['/present', '/hostage']));

    // Then: with no scope every path counts as drawn, which is the behaviour every caller had
    // before the scope existed; with one, the field the form never draws is named.
    expect(conditionsOf(ghost)).toHaveLength(1);
    expect(withoutScope).toEqual({ holds: true, undrawn: [] });
    expect(withScope).toEqual({ holds: false, undrawn: ['absent'] });
  });

  it('should never report holds while a field is undrawn', () => {
    // Given
    const ghost = schemas.Ghost?.normalized ?? {};
    const condition = conditionsOf(ghost)[0] ?? { words: '', clauses: [], requires: [] };

    // When: the value that would satisfy it is in the map, and the form draws no control for it.
    const reading = readCondition(condition, { '/absent': 'x' }, '', new Set(['/present']));

    // Then
    expect(reading.holds).toBe(false);
    expect(reading.undrawn).toEqual(['absent']);
  });
});
