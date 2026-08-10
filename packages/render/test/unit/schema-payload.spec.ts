import { describe, expect, it } from 'vitest';
import {
  buildSchemaPayload,
  SCHEMA_PAYLOAD_LIMIT,
  schemaMapOf,
} from '../../src/page/domain/schema-payload';
import { cyclicDocument, smallDocument } from '../mocks/documents';

/**
 * The bound on what a page carries, per `schema-payload.ts`.
 *
 * The measurement that produced the bound is in that file. What is asserted here is that the
 * bound behaves: the closure is reached, a cycle does not make it run forever, and what is
 * dropped is named rather than silently missing.
 */
describe('buildSchemaPayload', () => {
  it('should carry the whole closure of a use site', () => {
    // Given, Node points at Person and Person points back at Node.
    const document = cyclicDocument();

    // When
    const payload = buildSchemaPayload(document, [{ kind: 'named', schemaId: 'Node' }]);

    // Then
    expect(Object.keys(payload.schemas).sort()).toEqual(['Node', 'Person']);
    expect(payload.truncated).toEqual([]);
  });

  it('should terminate on a schema that refers to itself', () => {
    // Given, `Node.parent` is a `Node`. A walk with no seen set never returns.
    const document = cyclicDocument();

    // When
    const payload = buildSchemaPayload(document, [{ kind: 'named', schemaId: 'Node' }]);

    // Then
    expect(payload.schemas.Node).toBeDefined();
    expect(payload.bytes).toBeGreaterThan(0);
  });

  it('should follow the references an inline body holds', () => {
    // Given, a use site that is an array of a named schema rather than the schema itself.
    const document = smallDocument();
    const listing = [...document.nodes.values()].find((node) => node.kind === 'operation');
    const slot =
      listing?.kind === 'operation' ? listing.responses[0]?.content[0]?.schema : undefined;

    // When
    const payload = buildSchemaPayload(document, slot === undefined ? [] : [slot]);

    // Then
    expect(slot?.kind).toBe('inline');
    expect(Object.keys(payload.schemas)).toContain('Order');
  });

  it('should name what the bound dropped rather than leaving it missing', () => {
    // Given, a limit small enough that the second schema does not fit.
    const document = cyclicDocument();

    // When
    const payload = buildSchemaPayload(document, [{ kind: 'named', schemaId: 'Node' }], 200);

    // Then
    expect(payload.truncated.length).toBeGreaterThan(0);
    expect(Object.keys(payload.schemas)).not.toContain(payload.truncated[0]);
  });

  it('should keep filling after one schema does not fit', () => {
    // Given, two use sites and a limit that admits the second and not the first. Stopping at the
    // first refusal would hide every cheap schema behind one expensive one, and the reader would
    // lose a schema they could have had because of one they could not.
    const document = cyclicDocument();
    const small = JSON.stringify(document.schemas.get('Circle')).length + 20;

    // When
    const payload = buildSchemaPayload(
      document,
      [
        { kind: 'named', schemaId: 'Node' },
        { kind: 'named', schemaId: 'Circle' },
      ],
      small,
    );

    // Then
    expect(Object.keys(payload.schemas)).toEqual(['Circle']);
    expect(payload.truncated).toContain('Node');
    expect(payload.bytes).toBeLessThanOrEqual(small);
  });

  it('should record an id that names no schema rather than dropping the reference', () => {
    // Given
    const document = cyclicDocument();

    // When
    const payload = buildSchemaPayload(document, [{ kind: 'named', schemaId: 'Nothing' }]);

    // Then
    expect(payload.schemas).toEqual({});
    expect(payload.truncated).toEqual(['Nothing']);
  });

  it('should ship a schema without its raw form', () => {
    // Given, `raw` is the untouched source of a non JSON Schema dialect. Nothing in the viewer
    // reads it and on a document that has one it is the largest field there is.
    const document = cyclicDocument();

    // When
    const payload = buildSchemaPayload(document, [{ kind: 'named', schemaId: 'Circle' }]);

    // Then
    expect(payload.schemas.Circle).toBeDefined();
    expect(payload.schemas.Circle).not.toHaveProperty('raw');
  });

  it('should stay inside the limit it was given', () => {
    // Given
    const document = cyclicDocument();

    // When
    const payload = buildSchemaPayload(document, [{ kind: 'named', schemaId: 'Node' }], 400);

    // Then
    expect(payload.bytes).toBeLessThanOrEqual(400);
    expect(SCHEMA_PAYLOAD_LIMIT).toBe(128 * 1024);
  });
});

describe('schemaMapOf', () => {
  it('should produce the map the expander takes', () => {
    // Given, the payload travels as an object because that is what JSON has, and the expander
    // takes a Map because that is what the IR has.
    const document = cyclicDocument();
    const payload = buildSchemaPayload(document, [{ kind: 'named', schemaId: 'Node' }]);

    // When
    const map = schemaMapOf(payload.schemas);

    // Then
    expect(map.get('Node')?.normalized).toBeDefined();
    expect([...map.keys()].sort()).toEqual(Object.keys(payload.schemas).sort());
  });
});
