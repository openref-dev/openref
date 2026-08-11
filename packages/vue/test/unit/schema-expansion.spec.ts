import type { IRDocument, IRJsonSchema } from '@openref/core';
import { describe, expect, it } from 'vitest';
import type { SchemaTreeNode } from '../../src/index';
import {
  expandSchemaNode,
  inlineSchemaTreeRoot,
  schemaDisplayName,
  schemaTreeRoot,
} from '../../src/index';
import {
  mutuallyRecursiveDocument,
  selfRecursiveDocument,
  simpleDocument,
  threeSchemaCycleDocument,
  variantDocument,
  wrappedReferenceDocument,
} from '../mocks/documents';

/**
 * Cycle protection belongs to the expander, per SPEC 5.1.1 and the T008 amendment.
 *
 * Core marks a cycle among targets that have no name, because such a target is substituted in
 * place. A cycle among named schemas carries no marker and never will: the reference does not
 * expand, so nothing has to terminate it, and marking one of the schemas would have made the
 * IR depend on which one the traversal reached first.
 *
 * These tests therefore prove two things together: that the IR really carries no marker, and
 * that the expander terminates anyway, on its own path tracking.
 */

/** Walk the whole tree, bounded, so a failure to terminate fails the test rather than hanging. */
function walk(
  root: SchemaTreeNode,
  document: IRDocument,
  budget = 500,
): { readonly visited: SchemaTreeNode[]; readonly exhausted: boolean } {
  const visited: SchemaTreeNode[] = [];
  const queue: SchemaTreeNode[] = [root];

  while (queue.length > 0) {
    if (visited.length >= budget) return { visited, exhausted: true };
    const node = queue.shift();
    if (node === undefined) break;
    visited.push(node);
    queue.push(...expandSchemaNode(node, { schemas: document.schemas }));
  }

  return { visited, exhausted: false };
}

/** Every schema body in a document, flattened, so `$cycle` can be looked for exhaustively. */
function everySchemaNode(document: IRDocument): IRJsonSchema[] {
  const found: IRJsonSchema[] = [];

  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value as readonly unknown[]) visit(item);
      return;
    }
    if (value === null || typeof value !== 'object') return;
    found.push(value);
    for (const child of Object.values(value as Record<string, unknown>)) visit(child);
  };

  for (const schema of document.schemas.values()) visit(schema.normalized);
  return found;
}

describe('schema tree expansion, named cycles', () => {
  it('should carry no $cycle marker in the IR for a mutually recursive named pair', () => {
    // Given, this is the premise of everything below: there is no marker to rely on.
    const document = mutuallyRecursiveDocument();

    // When
    const markers = everySchemaNode(document).filter((node) => node.$cycle !== undefined);

    // Then
    expect(markers).toEqual([]);
  });

  it('should terminate on a mutually recursive named pair and report the revisit', () => {
    // Given
    const document = mutuallyRecursiveDocument();
    const root = schemaTreeRoot('A', { schemas: document.schemas });

    // When
    const { visited, exhausted } = walk(root!, document);

    // Then
    expect(exhausted).toBe(false);
    const revisits = visited.filter((node) => node.cycle);
    expect(revisits).toHaveLength(1);
    expect(revisits[0]?.cycleTarget).toBe('A');
    expect(revisits[0]?.path).toBe('A/b/a');
  });

  it('should produce no children at the position that closes a cycle', () => {
    // Given
    const document = mutuallyRecursiveDocument();
    const root = schemaTreeRoot('A', { schemas: document.schemas });
    const { visited } = walk(root!, document);
    const revisit = visited.find((node) => node.cycle);

    // When
    const children = expandSchemaNode(revisit!, { schemas: document.schemas });

    // Then
    expect(children).toEqual([]);
    expect(revisit?.expandable).toBe(false);
  });

  it('should carry no $cycle marker in the IR for a three schema ring', () => {
    // Given
    const document = threeSchemaCycleDocument();

    // When
    const markers = everySchemaNode(document).filter((node) => node.$cycle !== undefined);

    // Then
    expect(markers).toEqual([]);
  });

  it('should terminate on a three schema ring, where the revisit is not the parent', () => {
    // Given
    const document = threeSchemaCycleDocument();
    const root = schemaTreeRoot('A', { schemas: document.schemas });

    // When
    const { visited, exhausted } = walk(root!, document);

    // Then
    expect(exhausted).toBe(false);
    expect(visited.map((node) => node.path)).toEqual(['A', 'A/b', 'A/b/c', 'A/b/c/a']);
    expect(visited.at(-1)?.cycle).toBe(true);
    expect(visited.at(-1)?.cycleTarget).toBe('A');
  });

  it('should terminate on a schema that refers to itself', () => {
    // Given
    const document = selfRecursiveDocument();
    const root = schemaTreeRoot('Node', { schemas: document.schemas });

    // When
    const { visited, exhausted } = walk(root!, document);

    // Then
    expect(exhausted).toBe(false);
    expect(visited.filter((node) => node.cycle).map((node) => node.path)).toEqual([
      'Node/children/items',
    ]);
  });

  it('should keep the reference path per branch rather than globally, so a shared schema is not mistaken for a cycle', () => {
    // Given, `Method` names `Card` and `Bank`, and neither is on the other's path.
    const document = variantDocument();
    const root = schemaTreeRoot('Method', { schemas: document.schemas });

    // When
    const { visited } = walk(root!, document);

    // Then
    expect(visited.filter((node) => node.cycle)).toEqual([]);
    expect(visited.map((node) => node.label)).toContain('card');
    expect(visited.map((node) => node.label)).toContain('bank');
  });
});

describe('schema tree expansion, structure', () => {
  it('should expand one level at a time rather than the whole tree', () => {
    // Given
    const document = simpleDocument();
    const root = schemaTreeRoot('Order', { schemas: document.schemas });

    // When
    const children = expandSchemaNode(root!, { schemas: document.schemas });

    // Then
    expect(children.map((child) => child.label)).toEqual(['id', 'note', 'total']);
    expect(children.every((child) => !child.expandable)).toBe(true);
  });

  it('should mark a property named in required', () => {
    // Given
    const document = simpleDocument();
    const root = schemaTreeRoot('Order', { schemas: document.schemas });

    // When
    const children = expandSchemaNode(root!, { schemas: document.schemas });

    // Then
    expect(children.find((child) => child.label === 'id')?.required).toBe(true);
    expect(children.find((child) => child.label === 'total')?.required).toBe(false);
  });

  it('should drop positions outside the view being rendered', () => {
    // Given
    const document = simpleDocument();
    const options = { schemas: document.schemas, view: 'request' } as const;
    const root = schemaTreeRoot('Order', options);

    // When
    const children = expandSchemaNode(root!, options);

    // Then, `id` is readOnly and therefore not part of the request view.
    expect(children.map((child) => child.label)).toEqual(['note', 'total']);
  });

  it('should return undefined for a root over an id no schema carries', () => {
    // Given
    const document = simpleDocument();

    // When
    const root = schemaTreeRoot('Nothing', { schemas: document.schemas });

    // Then
    expect(root).toBeUndefined();
  });

  it('should build a root over a schema written inline', () => {
    // Given
    const schema: IRJsonSchema = { type: 'object', properties: { a: { type: 'string' } } };

    // When
    const root = inlineSchemaTreeRoot(schema, 'application/json', { schemas: new Map() });

    // Then
    expect(root.label).toBe('application/json');
    expect(root.schemaId).toBeUndefined();
    expect(root.expandable).toBe(true);
  });

  it('should keep an annotation written beside a reference, since it belongs to the use site', () => {
    // Given
    const document = simpleDocument();
    const schema: IRJsonSchema = { $ref: 'Order', description: 'the order being created' };

    // When
    const root = inlineSchemaTreeRoot(schema, 'body', { schemas: document.schemas });

    // Then
    expect(root.schema.description).toBe('the order being created');
    expect(root.schema.type).toBe('object');
  });

  it('should show the bare reference when the target is missing rather than inventing a body', () => {
    // Given
    const schema: IRJsonSchema = { $ref: 'Gone' };

    // When
    const root = inlineSchemaTreeRoot(schema, 'body', { schemas: new Map() });

    // Then
    expect(root.schemaId).toBe('Gone');
    expect(root.schema.$ref).toBe('Gone');
    expect(root.expandable).toBe(false);
  });

  it('should label oneOf branches by the discriminator mapping the normalizer produced', () => {
    // Given
    const document = variantDocument();
    const root = schemaTreeRoot('Method', { schemas: document.schemas });

    // When
    const children = expandSchemaNode(root!, { schemas: document.schemas });

    // Then
    expect(children.map((child) => child.relation)).toEqual(['variant', 'variant']);
    expect(children.map((child) => child.label).sort()).toEqual(['bank', 'card']);
  });
});

/**
 * What the expander shows at a position the document wrapped in a singleton `allOf`.
 *
 * The retrofit T003-R2 is in the normalizer, and the reason a reader ever saw the defect is
 * here: an anonymous object has no name to display and no page to link to, so `OrderDto.customer`
 * rendered as a row typed `object` while `CustomerDto` sat in the same sidebar with a page of
 * its own. These assertions are over the expander rather than over the IR, so they say what a
 * theme is handed.
 */
describe('schema tree expansion, a reference the document wrapped in allOf', () => {
  it('should name the target and carry its id, so a theme can label and link the position', () => {
    // Given
    const document = wrappedReferenceDocument();
    const root = schemaTreeRoot('OrderDto', { schemas: document.schemas });

    // When
    const children = expandSchemaNode(root!, { schemas: document.schemas });
    const customer = children.find((child) => child.label === 'customer');

    // Then
    expect(customer?.schemaId).toBe('CustomerDto');
    expect(customer?.schemaName).toBe('CustomerDto');
  });

  it('should open the target rather than showing a leaf, since the body is reachable', () => {
    // Given
    const document = wrappedReferenceDocument();
    const root = schemaTreeRoot('OrderDto', { schemas: document.schemas });
    const children = expandSchemaNode(root!, { schemas: document.schemas });
    const customer = children.find((child) => child.label === 'customer');

    // When
    const grandchildren = expandSchemaNode(customer!, { schemas: document.schemas });

    // Then
    expect(customer?.expandable).toBe(true);
    expect(grandchildren.map((child) => child.label)).toEqual(['id']);
  });

  it('should show the description the use site wrote, not the one the target carries', () => {
    // Given
    const document = wrappedReferenceDocument();
    const root = schemaTreeRoot('OrderDto', { schemas: document.schemas });

    // When
    const children = expandSchemaNode(root!, { schemas: document.schemas });

    // Then
    expect(children.find((child) => child.label === 'customer')?.schema.description).toBe(
      'Who placed it.',
    );
    expect(document.schemas.get('CustomerDto')?.normalized?.description).toBe(
      'The target says this.',
    );
  });

  it('should show the default the use site wrote, not the one the target carries', () => {
    // Given, the annotation set of SPEC 5.1.1 includes `default`, and a use site that states one
    // used to have it merged into the body. Once the merge stopped, dropping it here would have
    // lost a value the document stated.
    const document = wrappedReferenceDocument();
    const root = schemaTreeRoot('OrderDto', { schemas: document.schemas });

    // When
    const children = expandSchemaNode(root!, { schemas: document.schemas });

    // Then
    expect(children.find((child) => child.label === 'retries')?.schema.default).toBe(1);
    expect(document.schemas.get('Retries')?.normalized?.default).toBe(7);
  });
});

describe('schemaDisplayName', () => {
  it('should strip the identity marker an external target is registered under', () => {
    // Given, per SPEC 5.1.1 the marker is an identity mechanism and not a display string.
    const schema = {
      id: '~x1a2b3c4d~Order',
      name: '~x1a2b3c4d~Order',
      dialect: 'unknown',
    } as const;

    // When
    const name = schemaDisplayName(schema, schema.id);

    // Then
    expect(name).toBe('Order');
  });

  it('should leave a name that merely contains underscores alone', () => {
    // Given
    const schema = { id: 'Order_Line', name: 'Order_Line', dialect: 'unknown' } as const;

    // When
    const name = schemaDisplayName(schema, schema.id);

    // Then
    expect(name).toBe('Order_Line');
  });

  it('should show an internal schema that imitates an external id as the name it has', () => {
    // Given, the display side of F1: a document may call its own schema anything, and the id
    // it lands under is escaped so that nothing is stripped from it.
    const schema = {
      id: '~~x1a2b3c4d~~Order',
      name: '~~x1a2b3c4d~~Order',
      dialect: 'unknown',
    } as const;

    // When
    const name = schemaDisplayName(schema, schema.id);

    // Then
    expect(name).toBe('~x1a2b3c4d~Order');
  });

  it('should fall back to the id when the entry carries no name', () => {
    // Given, when nothing is registered under the id at all.

    // When
    const name = schemaDisplayName(undefined, 'Anonymous');

    // Then
    expect(name).toBe('Anonymous');
  });
});
