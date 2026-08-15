// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { normalizeOpenApiDocument, type IRSchema } from '@openref/core';
import { shapeRowsOf } from '../../src/page/domain/shape-rows';
import {
  announceSentence,
  conditionReason,
  deriveControls,
  keptCount,
  typeError,
  type ShapeChooserControl,
  type ShapeInputControl,
} from '../../src/page/domain/shape-form';
import { ShapesReader } from '../../src/components/ShapesReader';
import { ShapesFillPanel } from '../../src/components/ShapesFillPanel';

/**
 * Both halves of the shapes page, at the unit level, on the fixture's own constructs.
 *
 * THE DESIGNER'S LINE IS THE FIRST TEST: a reader must never conclude a field is always
 * required when it is required only sometimes. Every conditionally required name of the
 * fixture is asserted to print as conditional with its condition in words, and never as
 * required.
 */

/** The fixture's constructs, as a document the normalizer reads the way the demo's is read. */
function fixtureSchemas(): Readonly<Record<string, IRSchema>> {
  const document = normalizeOpenApiDocument({
    openapi: '3.1.0',
    info: { title: 'Shapes', version: '1.0.0' },
    paths: {},
    components: {
      schemas: {
        PaymentInstruction: {
          type: 'object',
          properties: {
            amountMinor: { type: 'integer', minimum: 1 },
            currency: { type: 'string', enum: ['EUR', 'USD'] },
            country: { type: 'string', enum: ['US', 'DE'] },
            postalCode: { type: 'string' },
            method: { type: 'string', enum: ['card', 'bank_transfer', 'invoice'] },
            metadata: {
              type: 'object',
              patternProperties: { '^x-[a-z0-9_]{2,32}$': { type: 'string', maxLength: 500 } },
              additionalProperties: false,
            },
            geo: {
              type: 'array',
              prefixItems: [
                { type: 'number', title: 'latitude' },
                { type: 'number', title: 'longitude' },
              ],
              items: false,
            },
          },
          required: ['amountMinor', 'currency', 'country', 'method'],
          if: { properties: { country: { const: 'US' } }, required: ['country'] },
          then: {
            required: ['postalCode'],
            properties: { postalCode: { pattern: '^[0-9]{5}$' } },
          },
          else: { properties: { postalCode: { maxLength: 12 } } },
          oneOf: [
            { $ref: '#/components/schemas/CardMethod' },
            { $ref: '#/components/schemas/BankTransferMethod' },
            { $ref: '#/components/schemas/InvoiceMethod' },
          ],
          discriminator: {
            propertyName: 'method',
            mapping: {
              card: '#/components/schemas/CardMethod',
              bank_transfer: '#/components/schemas/BankTransferMethod',
              invoice: '#/components/schemas/InvoiceMethod',
            },
          },
        },
        CardMethod: {
          type: 'object',
          properties: {
            method: { const: 'card' },
            pan: { type: 'string', minLength: 13, maxLength: 19 },
            holder: { type: 'string' },
            threeDSecure: {
              type: 'object',
              properties: { version: { type: 'string', enum: ['2.1.0', '2.2.0'] } },
              required: ['version'],
            },
          },
          required: ['method', 'pan', 'holder'],
          if: {
            properties: { amountMinor: { exclusiveMinimum: 5000 } },
            required: ['amountMinor'],
          },
          then: { required: ['threeDSecure'] },
        },
        BankTransferMethod: {
          type: 'object',
          properties: {
            method: { const: 'bank_transfer' },
            iban: { type: 'string' },
            bic: { type: 'string' },
            bankName: { type: 'string' },
          },
          required: ['method', 'iban'],
          dependentRequired: { bic: ['bankName'] },
        },
        InvoiceMethod: {
          type: 'object',
          properties: {
            method: { const: 'invoice' },
            terms: {
              oneOf: [
                {
                  type: 'object',
                  title: 'milestone',
                  properties: {
                    kind: { const: 'milestone' },
                    schedule: {
                      oneOf: [
                        {
                          type: 'object',
                          title: 'by dates',
                          properties: {
                            basis: { const: 'dates' },
                            dates: { type: 'array', items: { type: 'string', format: 'date' } },
                          },
                          required: ['basis', 'dates'],
                        },
                        {
                          type: 'object',
                          title: 'by percent',
                          properties: {
                            basis: { const: 'percent' },
                            percentages: { type: 'array', items: { type: 'number' } },
                          },
                          required: ['basis', 'percentages'],
                        },
                      ],
                    },
                  },
                  required: ['kind', 'schedule'],
                },
                {
                  type: 'object',
                  title: 'net',
                  properties: { kind: { const: 'net' }, days: { type: 'integer' } },
                  required: ['kind', 'days'],
                },
              ],
            },
          },
          required: ['method', 'terms'],
        },
      },
    },
  });

  return Object.fromEntries(document.schemas);
}

const schemas = fixtureSchemas();

describe('shapeRowsOf, the reading half', () => {
  it('should never print a conditionally required name as required, the designer line', () => {
    // Given the three names the fixture requires only under a condition
    const conditional = ['postalCode', 'threeDSecure', 'bankName'];

    // When
    const rows = shapeRowsOf('PaymentInstruction', schemas, '/docs');

    // Then each prints as conditional with its condition, and never as required
    for (const name of conditional) {
      const matches = rows.filter((row) => row.name === name);
      expect(matches.length, `no row for ${name}`).toBeGreaterThan(0);
      for (const row of matches) {
        expect(row.requiredness, `${name} must not read as required`).toBe('conditional');
        expect(row.when).toContain('required only when');
      }
    }
  });

  it('should state each condition in the words of its own mechanism', () => {
    // Given
    const rows = shapeRowsOf('PaymentInstruction', schemas, '/docs');
    const byName = (name: string): string => rows.find((row) => row.name === name)?.when ?? '';

    // Then: a const equality, a numeric bound, and a presence, each in its own words
    expect(byName('postalCode')).toBe('required only when country = US');
    expect(byName('threeDSecure')).toBe('required only when amountMinor > 5000');
    expect(byName('bankName')).toBe('required only when bic is present');
  });

  it('should expand every branch at once, down to the oneOf inside a oneOf branch', () => {
    // Given
    const rows = shapeRowsOf('PaymentInstruction', schemas, '/docs');
    const variants = rows.filter((row) => row.kind === 'variant');

    // Then the method branches, the terms branches and the schedule branches are all present,
    // depth first: the schedule branches sit inside milestone, before the sibling net
    expect(variants.map((row) => row.name)).toEqual([
      'card',
      'bank_transfer',
      'invoice',
      'milestone',
      'by dates',
      'by percent',
      'net',
    ]);

    // And each branch names the value that selects it
    expect(variants.find((row) => row.name === 'card')?.when).toBe('method = card');
    expect(variants.find((row) => row.name === 'milestone')?.when).toBe('kind = milestone');
    expect(variants.find((row) => row.name === 'by dates')?.when).toBe('basis = dates');

    // And the nesting is legible as depth: schedule branches sit below terms branches
    const milestone = variants.find((row) => row.name === 'milestone');
    const byDates = variants.find((row) => row.name === 'by dates');
    expect((byDates?.depth ?? 0) > (milestone?.depth ?? 0)).toBe(true);
  });

  it('should name the pattern, and the closed tuple with its tail', () => {
    // Given
    const rows = shapeRowsOf('PaymentInstruction', schemas, '/docs');

    // When
    const metadata = rows.find((row) => row.name === 'metadata');
    const pattern = rows.find((row) => row.kind === 'pattern');
    const geo = rows.find((row) => row.name === 'geo');

    // Then
    expect(metadata?.type).toBe('object, keys by pattern');
    expect(metadata?.when).toBe('^x-[a-z0-9_]{2,32}$');
    expect(pattern?.name).toBe('^x-[a-z0-9_]{2,32}$');
    expect(geo?.type).toBe('tuple [number, number]');
    expect(geo?.when).toBe('prefixItems: latitude, longitude; no items beyond the tuple');
  });

  it('should say the honest sentence for a condition it cannot translate', () => {
    // Given a condition whose if carries no readable comparison
    const local = Object.fromEntries(
      normalizeOpenApiDocument({
        openapi: '3.1.0',
        info: { title: 'x', version: '1' },
        paths: {},
        components: {
          schemas: {
            Opaque: {
              type: 'object',
              properties: { a: { type: 'string' }, b: { type: 'string' } },
              if: { properties: { a: { not: { type: 'null' } } } },
              then: { required: ['b'] },
            },
          },
        },
      }).schemas,
    );

    // When
    const rows = shapeRowsOf('Opaque', local, '/docs');
    const row = rows.find((candidate) => candidate.name === 'b');

    // Then the honest vagueness, never a guess and never plain required
    expect(row?.requiredness).toBe('conditional');
    expect(row?.when).toBe('required only when a condition the document states');
  });
});

describe('deriveControls, the filling half', () => {
  it('should draw no branch fields until the leading value is written', () => {
    // Given no values at all
    const controls = deriveControls('PaymentInstruction', schemas, {});
    const chooser = controls.find(
      (control): control is ShapeChooserControl => control.kind === 'chooser',
    );

    // Then the chooser stands with nothing pressed, and no branch field is drawn
    expect(chooser?.leading).toBe('method');
    expect(chooser?.options.map((option) => option.pressed)).toEqual([false, false, false]);
    expect(controls.some((control) => control.kind === 'input' && control.path === '/pan')).toBe(
      false,
    );
  });

  it('should draw the branch the leading value selects, and only that branch', () => {
    // Given
    const controls = deriveControls('PaymentInstruction', schemas, { '/method': 'card' });
    const paths = controls
      .filter((control): control is ShapeInputControl => control.kind === 'input')
      .map((control) => control.path);

    // Then
    expect(paths).toContain('/pan');
    expect(paths).toContain('/holder');
    expect(paths).not.toContain('/iban');
  });

  it('should keep hidden branch values and say the recorded announce sentence', () => {
    // Given a value typed into the card branch
    const values = { '/method': 'card', '/pan': '4111 11' };
    const controls = deriveControls('PaymentInstruction', schemas, values);
    const chooser = controls.find(
      (control): control is ShapeChooserControl => control.kind === 'chooser',
    );
    const card = chooser?.options.find((option) => option.label === 'card');

    // When the reader switches to bank_transfer: the map is untouched, only the leading moves
    const after = { ...values, '/method': 'bank_transfer' };
    const kept = keptCount(card?.ownedPaths ?? [], after);

    // Then the map still holds the value, the count says so, and the sentence is the
    // recorded wording: what rebuilt, not that something rebuilt
    expect(after['/pan']).toBe('4111 11');
    expect(kept).toBe(1);
    expect(announceSentence('card', 'bank_transfer', kept)).toBe(
      'Form rebuilt: branch card hidden, branch bank_transfer shown. Values kept from the hidden branch: 1.',
    );
    expect(announceSentence(null, 'card', 0)).toBe('Form rebuilt: branch card shown.');
  });

  it('should explain a condition by the condition and a type by the type', () => {
    // Given the condition holding
    const controls = deriveControls('PaymentInstruction', schemas, {
      '/country': 'US',
      '/method': 'card',
      '/pan': '4111 11',
    });
    const inputs = controls.filter(
      (control): control is ShapeInputControl => control.kind === 'input',
    );
    const postal = inputs.find((control) => control.path === '/postalCode');
    const pan = inputs.find((control) => control.path === '/pan');

    // Then the missing conditional field carries the condition's teaching sentence
    expect(postal?.conditionActive).toBe(true);
    expect(postal?.conditionReason).toBe(
      'Required because country = US. This is a condition, not the type: with another value the field is optional.',
    );
    expect(postal?.error).toBeUndefined();

    // And the wrong value carries the type's words, never the condition's
    expect(pan?.error).toBe('Expected string, length 13 to 19.');
    expect(conditionReason('country = US')).not.toContain('Expected');
  });

  it('should apply the then constraints under the condition and the else ones outside it', () => {
    // Given the same field on both sides of the condition
    const underUs = deriveControls('PaymentInstruction', schemas, {
      '/country': 'US',
      '/postalCode': 'abc',
    });
    const underDe = deriveControls('PaymentInstruction', schemas, {
      '/country': 'DE',
      '/postalCode': 'abcdefghijklmnop',
    });

    const postalUs = underUs.find(
      (control): control is ShapeInputControl =>
        control.kind === 'input' && control.path === '/postalCode',
    );
    const postalDe = underDe.find(
      (control): control is ShapeInputControl =>
        control.kind === 'input' && control.path === '/postalCode',
    );

    // Then the ZIP pattern binds only under the condition, the loose bound only outside it
    expect(postalUs?.error).toBe('Expected a value matching ^[0-9]{5}$.');
    expect(postalDe?.error).toBe('Expected string, length at most 12.');
  });

  it('should reach the third level: the schedule chooser inside the milestone branch', () => {
    // Given the invoice branch and its milestone terms
    const controls = deriveControls('PaymentInstruction', schemas, {
      '/method': 'invoice',
      '/terms/kind': 'milestone',
      '/terms/schedule/basis': 'dates',
    });

    const choosers = controls.filter(
      (control): control is ShapeChooserControl => control.kind === 'chooser',
    );
    const paths = controls
      .filter((control): control is ShapeInputControl => control.kind === 'input')
      .map((control) => control.path);

    // Then three choosers stand, one per level, and the deepest branch's field is drawn
    expect(choosers.map((chooser) => chooser.path)).toEqual([
      '/method',
      '/terms/kind',
      '/terms/schedule/basis',
    ]);
    expect(paths).toContain('/terms/schedule/dates');
  });

  it('should check a pattern key as the key condition, not the value type', () => {
    // Given one entry with a key outside the pattern
    const controls = deriveControls('PaymentInstruction', schemas, {
      '/metadata/#0/key': 'bad key',
      '/metadata/#0/value': 'x',
    });
    const pattern = controls.find((control) => control.kind === 'pattern');

    // Then
    expect(pattern?.kind).toBe('pattern');
    if (pattern?.kind === 'pattern') {
      expect(pattern.entries[0]?.keyError).toContain('^x-[a-z0-9_]{2,32}$');
      expect(pattern.entries[0]?.keyError).toContain("the key's condition, not the value's type");
    }
  });

  it('should close the tuple: one control per position and no add control', () => {
    // Given
    const controls = deriveControls('PaymentInstruction', schemas, {});
    const tuple = controls.find((control) => control.kind === 'tuple');

    // Then
    expect(tuple?.kind).toBe('tuple');
    if (tuple?.kind === 'tuple') {
      expect(tuple.positions).toHaveLength(2);
      expect(tuple.closed).toBe(true);
    }
  });
});

describe('typeError', () => {
  it('should speak each type violation in the type words', () => {
    // Given, When, Then
    expect(typeError('abc', { type: 'integer' })).toBe('Expected integer.');
    expect(typeError('3', { type: 'integer', minimum: 5 })).toBe('Expected integer >= 5.');
    expect(typeError('EUR', { type: 'string', enum: ['USD', 'GBP'] })).toBe(
      'Expected one of USD, GBP.',
    );
    expect(typeError('', { type: 'string', minLength: 3 })).toBeUndefined();
  });
});

describe('the two halves as markup', () => {
  async function html(component: unknown, props: Record<string, unknown>): Promise<string> {
    return renderToString(createSSRApp(component as never, props));
  }

  it('should render the reading half with the condition words in the rows', async () => {
    // When
    const markup = await html(ShapesReader, {
      schemaId: 'PaymentInstruction',
      schemas,
      basePath: '/docs',
    });

    // Then
    expect(markup).toContain('Reading: every branch at once');
    expect(markup).toContain('required only when country = US');
    expect(markup).toContain('required only when amountMinor &gt; 5000');
    expect(markup).toContain('oref-shape-variant');
    expect(markup).not.toContain('style=');
  });

  it('should render the filling half with the status line present and empty', async () => {
    // When
    const markup = await html(ShapesFillPanel, {
      schemaId: 'PaymentInstruction',
      schemas,
    });

    // Then the live region exists before it has anything to say, and no branch field is drawn
    expect(markup).toContain('role="status"');
    expect(markup).toContain('leading value: method');
    expect(markup).not.toContain('oref-field-shape--pan');
    expect(markup).not.toContain('style=');
  });
});
