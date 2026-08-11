import { describe, expect, it } from 'vitest';
import {
  ARRAY_EXAMPLE_LENGTH,
  canonicalize,
  generateExample,
  normalizeSchemaGraph,
  type IRJsonSchema,
} from '../../src/index';

describe('generateExample determinism', () => {
  it('should produce a byte identical example across 100 runs', () => {
    // Given
    const schema: IRJsonSchema = {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        createdAt: { type: 'string', format: 'date-time' },
        total: { type: 'number' },
        tags: { type: 'array', items: { type: 'string' } },
        status: { type: 'string', enum: ['open', 'closed'] },
        nested: { type: 'object', properties: { flag: { type: 'boolean' } } },
      },
    };

    // When
    const serialized = new Set(
      Array.from({ length: 100 }, () => canonicalize(generateExample(schema))),
    );

    // Then
    expect(serialized.size).toBe(1);
  });

  it('should not depend on the order the properties were written in', () => {
    // Given
    const first: IRJsonSchema = {
      type: 'object',
      properties: { b: { type: 'string' }, a: { type: 'integer' } },
    };
    const second: IRJsonSchema = {
      type: 'object',
      properties: { a: { type: 'integer' }, b: { type: 'string' } },
    };

    // When
    const results = [first, second].map((schema) => canonicalize(generateExample(schema)));

    // Then
    expect(results[0]).toBe(results[1]);
  });
});

describe('generateExample declared values', () => {
  it('should take const before anything else', () => {
    // Given
    const schema: IRJsonSchema = { type: 'string', const: 'fixed', enum: ['other'] };

    // When
    const example = generateExample(schema);

    // Then
    expect(example).toBe('fixed');
  });

  it('should take the first enum member, per SPEC 5.5', () => {
    // Given
    const schema: IRJsonSchema = { type: 'string', enum: ['open', 'closed', 'archived'] };

    // When
    const example = generateExample(schema);

    // Then
    expect(example).toBe('open');
  });

  it('should take the first declared example ahead of default', () => {
    // Given
    const schema: IRJsonSchema = { type: 'string', examples: ['written'], default: 'fallback' };

    // When
    const example = generateExample(schema);

    // Then
    expect(example).toBe('written');
  });

  it('should take default when there is no example and no enum', () => {
    // Given
    const schema: IRJsonSchema = { type: 'integer', default: 7 };

    // When
    const example = generateExample(schema);

    // Then
    expect(example).toBe(7);
  });
});

describe('generateExample by format and field name', () => {
  it('should use the format table for a date-time', () => {
    // Given
    const schema: IRJsonSchema = { type: 'string', format: 'date-time' };

    // When
    const example = generateExample(schema);

    // Then
    expect(example).toBe('2026-01-01T00:00:00Z');
  });

  it('should use the field name dictionary when no format is declared', () => {
    // Given
    const schema: IRJsonSchema = {
      type: 'object',
      properties: { customerEmail: { type: 'string' }, itemCount: { type: 'integer' } },
    };

    // When
    const example = generateExample(schema);

    // Then
    expect(example).toEqual({ customerEmail: 'user@example.com', itemCount: 2 });
  });

  it('should read an array element name from the singular of the field name', () => {
    // Given
    const schema: IRJsonSchema = {
      type: 'object',
      properties: { emails: { type: 'array', items: { type: 'string' } } },
    };

    // When
    const example = generateExample(schema);

    // Then
    expect(example).toEqual({ emails: ['user@example.com', 'user@example.com'] });
  });
});

describe('generateExample constraints', () => {
  it('should honour minLength by extending the value', () => {
    // Given
    const schema: IRJsonSchema = { type: 'string', minLength: 12 };

    // When
    const example = generateExample(schema);

    // Then
    expect(typeof example).toBe('string');
    expect(example as string).toHaveLength(12);
  });

  it('should honour maxLength by truncating the value', () => {
    // Given
    const schema: IRJsonSchema = { type: 'string', format: 'date-time', maxLength: 4 };

    // When
    const example = generateExample(schema);

    // Then
    expect(example).toBe('2026');
  });

  it('should honour maximum by lowering the value', () => {
    // Given
    const schema: IRJsonSchema = { type: 'integer', maximum: 0 };

    // When
    const example = generateExample(schema);

    // Then
    expect(example).toBe(0);
  });

  it('should honour minimum by raising the value', () => {
    // Given
    const schema: IRJsonSchema = { type: 'integer', minimum: 100 };

    // When
    const example = generateExample(schema);

    // Then
    expect(example).toBe(100);
  });

  it('should stay strictly inside an exclusive bound', () => {
    // Given
    const schema: IRJsonSchema = { type: 'integer', exclusiveMinimum: 5, exclusiveMaximum: 9 };

    // When
    const example = generateExample(schema);

    // Then
    expect(Number(example)).toBeGreaterThan(5);
    expect(Number(example)).toBeLessThan(9);
  });

  it('should honour multipleOf without floating point noise', () => {
    // Given
    const schema: IRJsonSchema = { type: 'number', multipleOf: 0.25, minimum: 1 };

    // When
    const example = generateExample(schema);

    // Then
    expect(Number(example) % 0.25).toBe(0);
    expect(String(example as number)).not.toContain('0000000');
  });

  it('should honour a trivially satisfiable pattern', () => {
    // Given
    const schema: IRJsonSchema = { type: 'string', pattern: '^[A-Z]{3}-\\d{4}$' };

    // When
    const example = generateExample(schema);

    // Then
    expect(example).toBe('AAA-0000');
    expect(new RegExp('^[A-Z]{3}-\\d{4}$').test(example as string)).toBe(true);
  });

  it('should keep a value that already satisfies the pattern rather than sampling one', () => {
    // Given
    const schema: IRJsonSchema = {
      type: 'string',
      format: 'date',
      pattern: '^\\d{4}-\\d{2}-\\d{2}$',
    };

    // When
    const example = generateExample(schema);

    // Then
    expect(example).toBe('2026-01-01');
  });

  it('should honour minItems and maxItems on an array', () => {
    // Given
    const atLeastThree: IRJsonSchema = { type: 'array', items: { type: 'integer' }, minItems: 3 };
    const atMostOne: IRJsonSchema = { type: 'array', items: { type: 'integer' }, maxItems: 1 };

    // When
    const examples = [generateExample(atLeastThree), generateExample(atMostOne)];

    // Then
    expect((examples[0] as unknown[]).length).toBe(3);
    expect((examples[1] as unknown[]).length).toBe(1);
  });

  it('should produce two elements by default, per SPEC 5.5', () => {
    // Given
    const schema: IRJsonSchema = { type: 'array', items: { type: 'string' } };

    // When
    const example = generateExample(schema);

    // Then
    expect((example as unknown[]).length).toBe(ARRAY_EXAMPLE_LENGTH);
  });

  it('should not emit duplicates when uniqueItems is declared', () => {
    // Given
    const schema: IRJsonSchema = { type: 'array', items: { type: 'boolean' }, uniqueItems: true };

    // When
    const example = generateExample(schema) as unknown[];

    // Then
    expect(new Set(example).size).toBe(example.length);
  });

  it('should honour maxProperties by keeping the first properties in canonical order', () => {
    // Given
    const schema: IRJsonSchema = {
      type: 'object',
      maxProperties: 1,
      properties: { b: { type: 'string' }, a: { type: 'string' } },
    };

    // When
    const example = generateExample(schema);

    // Then
    expect(Object.keys(example as object)).toEqual(['a']);
  });
});

describe('generateExample recursion', () => {
  it('should produce a finite example for a recursive schema', () => {
    // Given
    const document = {
      components: {
        schemas: {
          Node: {
            type: 'object',
            properties: {
              value: { type: 'string' },
              child: { $ref: '#/components/schemas/Node' },
            },
          },
        },
      },
    };
    const graph = normalizeSchemaGraph(
      { $ref: '#/components/schemas/Node' },
      { rootDocument: document },
    );

    // When, the generator follows references through the document's schema map and stops
    // when one leads back to a schema it is already generating
    const example = generateExample(graph.schema, { schemas: graph.schemas });

    // Then
    expect(example).toEqual({ child: null, value: 'string' });
  });

  it('should emit null for a reference it has no schema map to follow', () => {
    // Given
    const schema: IRJsonSchema = { $ref: 'Order' };

    // When
    const example = generateExample(schema);

    // Then, inventing a value for a type it cannot see would be a guess
    expect(example).toBeNull();
  });

  it('should follow a reference into the schema map when one is supplied', () => {
    // Given
    const schemas = new Map<string, IRJsonSchema>([['Money', { type: 'string', format: 'uuid' }]]);

    // When
    const example = generateExample({ $ref: 'Money' }, { schemas });

    // Then
    expect(example).toBe('00000000-0000-4000-8000-000000000000');
  });

  it('should take a value stated beside a reference rather than the target it points at', () => {
    // Given, the shape T003-R2 made ordinary: a wrapped property with a `default` of its own.
    // Forty of the 180 wrapped properties of kubernetes-apps-v1.json are written this way.
    const document = {
      components: {
        schemas: {
          Replicas: { type: 'integer', default: 3 },
          Spec: {
            type: 'object',
            properties: {
              replicas: {
                allOf: [{ $ref: '#/components/schemas/Replicas' }],
                default: 1,
                description: 'How many this deployment wants.',
              },
            },
          },
        },
      },
    };
    const graph = normalizeSchemaGraph(
      { $ref: '#/components/schemas/Spec' },
      { rootDocument: document },
    );

    // When
    const example = generateExample(graph.schema, { schemas: graph.schemas });

    // Then, the use site's value, not the target's. Following the reference first would have
    // shown 3, which is a number the document never wrote about this position.
    expect(example).toEqual({ replicas: 1 });
  });

  it('should still follow the reference when the use site states no value of its own', () => {
    // Given
    const schemas = new Map<string, IRJsonSchema>([['Replicas', { type: 'integer', default: 3 }]]);

    // When
    const example = generateExample(
      { $ref: 'Replicas', description: 'A description only.' },
      {
        schemas,
      },
    );

    // Then
    expect(example).toBe(3);
  });

  it('should stop at the depth limit for a schema that nests without a marked cycle', () => {
    // Given, hand assembled rather than normalized, so no $cycle marker exists
    const leaf: IRJsonSchema = { type: 'object', properties: { value: { type: 'integer' } } };
    let schema: IRJsonSchema = leaf;
    for (let level = 0; level < 30; level += 1) {
      schema = { type: 'object', properties: { child: schema } };
    }

    // When
    const example = generateExample(schema, { maxDepth: 4 });

    // Then
    expect(example).toEqual({ child: { child: { child: { child: null } } } });
  });
});

describe('generateExample views and composition', () => {
  it('should drop readOnly properties from the request view', () => {
    // Given
    const schema: IRJsonSchema = {
      type: 'object',
      properties: { id: { type: 'string', readOnly: true }, name: { type: 'string' } },
    };

    // When
    const example = generateExample(schema, { view: 'request' });

    // Then
    expect(Object.keys(example as object)).toEqual(['name']);
  });

  it('should drop writeOnly properties from the response view', () => {
    // Given
    const schema: IRJsonSchema = {
      type: 'object',
      properties: { password: { type: 'string', writeOnly: true }, name: { type: 'string' } },
    };

    // When
    const example = generateExample(schema, { view: 'response' });

    // Then
    expect(Object.keys(example as object)).toEqual(['name']);
  });

  it('should take the first variant of a oneOf', () => {
    // Given
    const schema: IRJsonSchema = {
      variants: [
        { label: 'Card', schema: { type: 'object', properties: { pan: { type: 'string' } } } },
        { label: 'Cash', schema: { type: 'object', properties: { note: { type: 'string' } } } },
      ],
    };

    // When
    const example = generateExample(schema);

    // Then
    expect(Object.keys(example as object)).toEqual(['pan']);
  });

  it('should take the first non null member of a type union', () => {
    // Given
    const schema: IRJsonSchema = { type: ['null', 'integer'] };

    // When
    const example = generateExample(schema);

    // Then
    expect(example).toBe(1);
  });

  it('should infer object from properties when no type is declared', () => {
    // Given
    const schema: IRJsonSchema = { properties: { flag: { type: 'boolean' } } };

    // When
    const example = generateExample(schema);

    // Then
    expect(example).toEqual({ flag: true });
  });

  it('should show one entry for a map declared only by additionalProperties', () => {
    // Given
    const schema: IRJsonSchema = { type: 'object', additionalProperties: { type: 'integer' } };

    // When
    const example = generateExample(schema);

    // Then
    expect(example).toEqual({ additionalProp: 1 });
  });

  it('should emit null for a schema that says nothing at all', () => {
    // Given
    const schema: IRJsonSchema = {};

    // When
    const example = generateExample(schema);

    // Then
    expect(example).toBeNull();
  });
});
