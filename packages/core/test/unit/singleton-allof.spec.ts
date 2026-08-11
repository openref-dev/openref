import { describe, expect, it } from 'vitest';
import type { IRJsonSchema } from '../../src/index';
import { normalizeSchemaGraph } from '../../src/index';

/**
 * A singleton `allOf` around a reference is that reference, per SPEC 5.1.1 and retrofit T003-R2.
 *
 * THE SPECIFICATION ALREADY PROMISED THIS AND THE CODE DID THE OPPOSITE, from T003 to the end
 * of M0. The last sentence of the `allOf` decision read "one branch, so the reference is kept as
 * a reference", and the normalizer merged such a branch into an anonymous object, which took the
 * name of the target with it. Nothing checked the sentence, so it cost nothing to be wrong.
 * These tests are that check, and they are written over the whole rule rather than over the one
 * shape that was noticed, because the shape that was noticed is the one that gets fixed and the
 * neighbouring ones are the ones that get discovered later.
 *
 * It is not a NestJS quirk. `@nestjs/swagger` emits the wrapper the moment a property carries a
 * description, because a sibling of `$ref` is ignored in OpenAPI 3.0, but the counts come from
 * the corpus of SPEC 21 and not from a NestJS application: 180 of the 761 properties of
 * `kubernetes-apps-v1.json`, with zero bare references, 26 of 195 in
 * `kubernetes-apiextensions-v1.json`, and 22 of 2239 in `box.json`.
 */

function documentWith(schemas: Record<string, unknown>): Record<string, unknown> {
  return { components: { schemas } };
}

function reference(name: string): Record<string, unknown> {
  return { $ref: `#/components/schemas/${name}` };
}

/** The target every case below points at, so a lost name is visible as a lost body. */
const CUSTOMER = {
  type: 'object',
  description: 'The target says this.',
  required: ['id'],
  properties: { id: { type: 'string' } },
};

/** Normalizes one property written as a wrapper, and hands back what the IR put there. */
function propertyOf(wrapper: Record<string, unknown>): IRJsonSchema | undefined {
  const rootDocument = documentWith({
    Customer: CUSTOMER,
    Order: { type: 'object', properties: { customer: wrapper } },
  });

  const graph = normalizeSchemaGraph(reference('Order'), { rootDocument });
  return graph.schemas.get('Order')?.properties?.customer;
}

describe('singleton allOf around a reference, the shapes that keep the name', () => {
  it('should keep the reference when the wrapper carries nothing beside the allOf', () => {
    // Given, nine of the twenty two wrapped properties of box.json are written this way
    const wrapper = { allOf: [reference('Customer')] };

    // When
    const property = propertyOf(wrapper);

    // Then
    expect(property).toEqual({ $ref: 'Customer' });
  });

  it('should keep the reference and carry a description written beside the allOf', () => {
    // Given, the shape that made this defect visible, and the commonest one in the corpus
    const wrapper = { allOf: [reference('Customer')], description: 'The use site says this.' };

    // When
    const property = propertyOf(wrapper);

    // Then
    expect(property).toEqual({ $ref: 'Customer', description: 'The use site says this.' });
  });

  it('should keep the reference and carry a title beside the allOf', () => {
    // Given
    const wrapper = { allOf: [reference('Customer')], title: 'Buyer' };

    // When
    const property = propertyOf(wrapper);

    // Then
    expect(property).toEqual({ $ref: 'Customer', title: 'Buyer' });
  });

  it('should keep the reference and carry deprecated beside the allOf', () => {
    // Given
    const wrapper = { allOf: [reference('Customer')], deprecated: true };

    // When
    const property = propertyOf(wrapper);

    // Then
    expect(property).toEqual({ $ref: 'Customer', deprecated: true });
  });

  it('should keep the reference and carry readOnly beside the allOf, where the view split reads it', () => {
    // Given, `readOnly` decides whether this property exists in the request view at all, so
    // moving it onto a reference node has to leave it where `applyView` looks
    const wrapper = { allOf: [reference('Customer')], readOnly: true };

    // When
    const property = propertyOf(wrapper);

    // Then
    expect(property).toEqual({ $ref: 'Customer', readOnly: true });
  });

  it('should keep the reference and lift a 3.0 example beside the allOf into examples', () => {
    // Given, three of the twenty two wrapped properties of box.json carry one
    const wrapper = { allOf: [reference('Customer')], example: { id: 'cus_1' } };

    // When
    const property = propertyOf(wrapper);

    // Then
    expect(property).toEqual({ $ref: 'Customer', examples: [{ id: 'cus_1' }] });
  });

  it('should keep the reference and carry a default beside the allOf', () => {
    // Given, forty of the 180 wrapped properties of kubernetes-apps-v1.json are written this way
    const wrapper = {
      allOf: [reference('Customer')],
      default: null,
      description: 'With a default.',
    };

    // When
    const property = propertyOf(wrapper);

    // Then
    expect(property).toEqual({
      $ref: 'Customer',
      default: null,
      description: 'With a default.',
    });
  });

  it('should let the use site annotation beat one written inside the branch', () => {
    // Given, both describe this position and the outer one was written about it last
    const wrapper = {
      allOf: [{ ...reference('Customer'), description: 'inner' }],
      description: 'outer',
    };

    // When
    const property = propertyOf(wrapper);

    // Then
    expect(property).toEqual({ $ref: 'Customer', description: 'outer' });
  });

  it('should leave the target alone, so the annotation belongs to the use site only', () => {
    // Given
    const rootDocument = documentWith({
      Customer: CUSTOMER,
      Order: {
        type: 'object',
        properties: { customer: { allOf: [reference('Customer')], description: 'Here only.' } },
      },
    });

    // When
    const graph = normalizeSchemaGraph(reference('Order'), { rootDocument });

    // Then, one body in the map, still saying what the target says
    expect(graph.schemas.get('Customer')?.description).toBe('The target says this.');
  });
});

describe('singleton allOf around a reference, the shapes that still merge', () => {
  it('should merge when a second branch constrains the reference', () => {
    // Given
    const wrapper = {
      allOf: [
        reference('Customer'),
        { required: ['tier'], properties: { tier: { type: 'string' } } },
      ],
    };

    // When
    const property = propertyOf(wrapper);

    // Then, a merge that stopped merging would be a worse defect than the one this fixes
    expect(property?.$ref).toBeUndefined();
    expect(property?.required).toEqual(['id', 'tier']);
    expect(Object.keys(property?.properties ?? {})).toEqual(['id', 'tier']);
  });

  it('should merge when the second branch is empty, because the rule counts branches', () => {
    // Given, deciding on emptiness would mean defining it for `{}`, for `true`, and for a branch
    // carrying only a description, and each is a separate judgement. Measured on the corpus of
    // SPEC 21: this shape occurs zero times, so counting branches costs nothing real.
    const wrapper = { allOf: [reference('Customer'), {}] };

    // When
    const property = propertyOf(wrapper);

    // Then
    expect(property?.$ref).toBeUndefined();
    expect(Object.keys(property?.properties ?? {})).toEqual(['id']);
  });

  it('should merge when a sibling of the allOf constrains rather than annotates', () => {
    // Given
    const wrapper = { allOf: [reference('Customer')], minProperties: 2 };

    // When
    const property = propertyOf(wrapper);

    // Then
    expect(property?.$ref).toBeUndefined();
    expect(property?.minProperties).toBe(2);
  });

  it('should merge when an extension sits beside the allOf, because a vendor key may constrain', () => {
    // Given, the whole cost of this decision on the corpus is two properties of about 3200:
    // one in box.json and one in kubernetes-apps-v1.json
    const wrapper = { allOf: [reference('Customer')], 'x-kubernetes-patch-strategy': 'merge' };

    // When
    const property = propertyOf(wrapper);

    // Then
    expect(property?.$ref).toBeUndefined();
    expect(property?.extensions).toEqual({ 'x-kubernetes-patch-strategy': 'merge' });
  });

  it('should merge when the single branch is an inline object rather than a reference', () => {
    // Given
    const wrapper = { allOf: [{ type: 'object', properties: { id: { type: 'string' } } }] };

    // When
    const property = propertyOf(wrapper);

    // Then
    expect(property?.$ref).toBeUndefined();
    expect(property?.type).toBe('object');
  });

  it('should merge when the single branch points at a target with no name of its own', () => {
    // Given, a pointer into a parameter has nothing in `document.schemas` to point at, so it was
    // substituted where it stood and is not a reference by the time the rule is asked
    const rootDocument = {
      components: {
        parameters: { Limit: { schema: { type: 'integer' } } },
        schemas: {
          Order: {
            type: 'object',
            properties: {
              limit: {
                allOf: [{ $ref: '#/components/parameters/Limit/schema' }],
                description: 'd',
              },
            },
          },
        },
      },
    };

    // When
    const graph = normalizeSchemaGraph(reference('Order'), { rootDocument });
    const property = graph.schemas.get('Order')?.properties?.limit;

    // Then
    expect(property?.$ref).toBeUndefined();
    expect(property?.type).toBe('integer');
  });
});

describe('singleton allOf around a reference, what the model gains by it', () => {
  it('should give two wrapped use sites of one schema one reference rather than two copies', () => {
    // Given, the reason SPEC 5.1.1 states this as a model and not an optimization: federation
    // deduplicates by the hash of a schema, and `diff` classifies a change to it once
    const rootDocument = documentWith({
      Customer: CUSTOMER,
      Order: {
        type: 'object',
        properties: {
          buyer: { allOf: [reference('Customer')], description: 'Who paid.' },
          recipient: { allOf: [reference('Customer')], description: 'Who receives it.' },
        },
      },
    });

    // When
    const graph = normalizeSchemaGraph(reference('Order'), { rootDocument });
    const order = graph.schemas.get('Order');

    // Then
    expect(order?.properties?.buyer?.$ref).toBe('Customer');
    expect(order?.properties?.recipient?.$ref).toBe('Customer');
    expect([...graph.schemas.keys()].sort()).toEqual(['Customer', 'Order']);
  });

  it('should terminate on a schema that wraps a reference back to itself', () => {
    // Given, this used to force the target to be produced in order to be merged, which is the
    // one case a self reference has no answer for. As a reference it needs no answer.
    const rootDocument = documentWith({
      Category: {
        type: 'object',
        properties: {
          parent: { allOf: [reference('Category')], description: 'The one above.' },
        },
      },
    });

    // When
    const graph = normalizeSchemaGraph(reference('Category'), { rootDocument });

    // Then
    expect(graph.schemas.get('Category')?.properties?.parent).toEqual({
      $ref: 'Category',
      description: 'The one above.',
    });
  });
});
