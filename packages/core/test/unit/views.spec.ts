import { describe, expect, it } from 'vitest';
import type { IRJsonSchema } from '../../src/index';
import { applyView, toRequestView, toResponseView } from '../../src/index';

function createUser(): IRJsonSchema {
  return {
    type: 'object',
    title: 'User',
    required: ['id', 'name', 'password'],
    properties: {
      id: { type: 'string', readOnly: true },
      name: { type: 'string' },
      password: { type: 'string', writeOnly: true },
    },
  };
}

function withoutView(schema: IRJsonSchema): unknown {
  const { view: _view, properties, ...rest } = schema;
  if (properties === undefined) return rest;

  return {
    ...rest,
    properties: Object.fromEntries(
      Object.entries(properties).map(([name, member]) => [name, withoutView(member)]),
    ),
  };
}

describe('toRequestView', () => {
  it('should drop readOnly properties and keep everything else', () => {
    // Given
    const schema = createUser();

    // When
    const view = toRequestView(schema);

    // Then
    expect(Object.keys(view.properties ?? {})).toEqual(['name', 'password']);
  });

  it('should drop the dropped names from required as well', () => {
    // Given
    const schema = createUser();

    // When
    const view = toRequestView(schema);

    // Then
    expect(view.required).toEqual(['name', 'password']);
  });
});

describe('toResponseView', () => {
  it('should drop writeOnly properties and keep everything else', () => {
    // Given
    const schema = createUser();

    // When
    const view = toResponseView(schema);

    // Then
    expect(Object.keys(view.properties ?? {})).toEqual(['id', 'name']);
  });

  it('should drop the dropped names from required as well', () => {
    // Given
    const schema = createUser();

    // When
    const view = toResponseView(schema);

    // Then
    expect(view.required).toEqual(['id', 'name']);
  });
});

describe('the two views of one schema', () => {
  it('should differ exactly by the marked fields', () => {
    // Given
    const schema = createUser();

    // When
    const request = toRequestView(schema);
    const response = toResponseView(schema);

    // Then
    const requestNames = Object.keys(request.properties ?? {});
    const responseNames = Object.keys(response.properties ?? {});
    expect(requestNames.filter((name) => !responseNames.includes(name))).toEqual(['password']);
    expect(responseNames.filter((name) => !requestNames.includes(name))).toEqual(['id']);
  });

  it('should leave an unmarked schema structurally identical in both views', () => {
    // Given
    const schema: IRJsonSchema = {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    };

    // When
    const request = withoutView(toRequestView(schema));
    const response = withoutView(toResponseView(schema));

    // Then
    expect(request).toEqual(response);
  });

  it('should stamp the view on every level', () => {
    // Given
    const schema: IRJsonSchema = {
      type: 'object',
      properties: { child: { type: 'object', properties: { leaf: { type: 'string' } } } },
    };

    // When
    const view = toRequestView(schema);

    // Then
    const child = view.properties?.child;
    expect([view.view, child?.view, child?.properties?.leaf?.view]).toEqual([
      'request',
      'request',
      'request',
    ]);
  });

  it('should not leave the original schema modified', () => {
    // Given
    const schema = createUser();
    const before = JSON.stringify(schema);

    // When
    toRequestView(schema);

    // Then
    expect(JSON.stringify(schema)).toBe(before);
  });
});

describe('applyView', () => {
  it('should reach into items, oneOf, anyOf, allOf and variants', () => {
    // Given
    const leaf: IRJsonSchema = {
      type: 'object',
      properties: { secret: { type: 'string', writeOnly: true }, open: { type: 'string' } },
    };
    const schema: IRJsonSchema = {
      items: leaf,
      oneOf: [leaf],
      anyOf: [leaf],
      allOf: [leaf],
      variants: [{ label: 'Leaf', schema: leaf }],
      not: leaf,
      propertyNames: { type: 'string' },
      additionalProperties: leaf,
      prefixItems: [leaf],
    };

    // When
    const view = toResponseView(schema);

    // Then
    const reached = [
      view.items?.properties,
      view.oneOf?.[0]?.properties,
      view.anyOf?.[0]?.properties,
      view.allOf?.[0]?.properties,
      view.variants?.[0]?.schema.properties,
      view.not?.properties,
      view.prefixItems?.[0]?.properties,
      typeof view.additionalProperties === 'object' ? view.additionalProperties.properties : {},
    ].map((properties) => Object.keys(properties ?? {}));

    expect(reached).toEqual(Array.from({ length: 8 }, () => ['open']));
  });

  it('should leave a folded cycle marker alone', () => {
    // Given
    const schema: IRJsonSchema = {
      type: 'object',
      properties: { next: { $cycle: 'Node' } },
    };

    // When
    const view = toRequestView(schema);

    // Then
    expect(view.properties?.next).toEqual({ $cycle: 'Node' });
  });

  it('should mark but not remove anything for the both view', () => {
    // Given
    const schema = createUser();

    // When
    const view = applyView(schema, 'both');

    // Then
    expect(Object.keys(view.properties ?? {})).toEqual(['id', 'name', 'password']);
    expect(view.view).toBe('both');
  });

  it('should terminate on a schema that references itself through an object graph', () => {
    // Given
    const schema: { -readonly [Key in keyof IRJsonSchema]: IRJsonSchema[Key] } = {
      type: 'object',
    };
    schema.properties = { self: schema };

    // When
    const view = applyView(schema, 'request');

    // Then
    expect(view.properties?.self).toBeDefined();
  });
});
