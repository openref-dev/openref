import { describe, expect, it } from 'vitest';
import {
  buildSchema,
  dialectFromSchemaFormat,
  ErrorCode,
  isJsonSchemaCompatible,
  JSON_SCHEMA_DIALECTS,
  normalizeSchemaFormat,
  UnsupportedDialectError,
} from '../../src/index';

const OPTIONS = { rootDocument: {} };

describe('isJsonSchemaCompatible', () => {
  it('should accept every dialect that goes through the common pipeline', () => {
    // Given
    const dialects = JSON_SCHEMA_DIALECTS;

    // When
    const results = dialects.map((dialect) => isJsonSchemaCompatible(dialect));

    // Then
    expect(results.every(Boolean)).toBe(true);
  });

  it('should reject avro, protobuf and unknown, which take the raw path', () => {
    // Given
    const dialects = ['avro', 'protobuf', 'unknown'] as const;

    // When
    const results = dialects.map((dialect) => isJsonSchemaCompatible(dialect));

    // Then
    expect(results).toEqual([false, false, false]);
  });
});

describe('normalizeSchemaFormat', () => {
  it('should drop the version parameter and the case', () => {
    // Given
    const format = 'APPLICATION/vnd.apache.avro;version=1.9.0';

    // When
    const media = normalizeSchemaFormat(format);

    // Then
    expect(media).toBe('application/vnd.apache.avro');
  });
});

describe('dialectFromSchemaFormat', () => {
  it('should identify avro from the apache vendor tree', () => {
    // Given
    const format = 'application/vnd.apache.avro+json;version=1.9.0';

    // When
    const dialect = dialectFromSchemaFormat(format);

    // Then
    expect(dialect).toBe('avro');
  });

  it('should identify protobuf from the google vendor tree', () => {
    // Given
    const format = 'application/vnd.google.protobuf;version=3';

    // When
    const dialect = dialectFromSchemaFormat(format);

    // Then
    expect(dialect).toBe('protobuf');
  });

  it('should identify json schema from the schema media type', () => {
    // Given
    const format = 'application/schema+json;version=draft-07';

    // When
    const dialect = dialectFromSchemaFormat(format);

    // Then
    expect(dialect).toBe('json-schema-2020-12');
  });

  it('should identify an asyncapi schema from the aai vendor tree', () => {
    // Given
    const format = 'application/vnd.aai.asyncapi+json;version=3.0.0';

    // When
    const dialect = dialectFromSchemaFormat(format);

    // Then
    expect(dialect).toBe('asyncapi-schema');
  });

  it('should call a well formed format it does not know unknown rather than raising', () => {
    // Given
    const format = 'application/vnd.acme.thrift;version=1';

    // When
    const dialect = dialectFromSchemaFormat(format);

    // Then
    expect(dialect).toBe('unknown');
  });

  it('should raise when schemaFormat is not a string', () => {
    // Given
    const format = 42;

    // When
    const act = (): unknown => dialectFromSchemaFormat(format);

    // Then
    expect(act).toThrow(UnsupportedDialectError);
  });

  it('should raise with the unsupported dialect code when schemaFormat is blank', () => {
    // Given
    const format = '   ';

    // When
    let code: string | undefined;
    try {
      dialectFromSchemaFormat(format);
    } catch (error) {
      code = error instanceof UnsupportedDialectError ? error.code : undefined;
    }

    // Then
    expect(code).toBe(ErrorCode.NORM_UNSUPPORTED_DIALECT);
  });

  it('should raise when the value carries parameters but names no media type', () => {
    // Given
    const format = ';version=1.9.0';

    // When
    const act = (): unknown => dialectFromSchemaFormat(format);

    // Then
    expect(act).toThrow(UnsupportedDialectError);
  });
});

describe('buildSchema', () => {
  it('should normalize a bare payload under the default dialect', () => {
    // Given
    const payload = { type: 'object', properties: { id: { type: 'string' } } };

    // When
    const schema = buildSchema({
      id: 'Order',
      payload,
      defaultDialect: 'json-schema-2020-12',
      normalizeOptions: OPTIONS,
    });

    // Then
    expect(schema.dialect).toBe('json-schema-2020-12');
    expect(schema.normalized?.type).toBe('object');
    expect(schema.raw).toBeUndefined();
  });

  it('should keep an avro payload raw with normalized absent', () => {
    // Given
    const payload = {
      schemaFormat: 'application/vnd.apache.avro;version=1.9.0',
      schema: { type: 'record', name: 'Order', fields: [{ name: 'id', type: 'string' }] },
    };

    // When
    const schema = buildSchema({
      id: 'OrderPlaced',
      payload,
      defaultDialect: 'asyncapi-schema',
      normalizeOptions: OPTIONS,
    });

    // Then
    expect(schema.dialect).toBe('avro');
    expect(schema.normalized).toBeUndefined();
    expect(schema.raw).toEqual(payload);
  });

  it('should keep a protobuf payload raw with normalized absent', () => {
    // Given
    const payload = {
      schemaFormat: 'application/vnd.google.protobuf;version=3',
      schema: 'message Order { string id = 1; }',
    };

    // When
    const schema = buildSchema({
      id: 'OrderProto',
      payload,
      defaultDialect: 'asyncapi-schema',
      normalizeOptions: OPTIONS,
    });

    // Then
    expect(schema.dialect).toBe('protobuf');
    expect(schema.normalized).toBeUndefined();
    expect(schema.raw).toEqual(payload);
  });

  it('should keep the schemaFormat string inside raw, so the renderer can name the dialect', () => {
    // Given
    const payload = { schemaFormat: 'application/vnd.acme.thrift', schema: { a: 1 } };

    // When
    const schema = buildSchema({
      id: 'Thing',
      payload,
      defaultDialect: 'asyncapi-schema',
      normalizeOptions: OPTIONS,
    });

    // Then
    expect(schema.dialect).toBe('unknown');
    expect(schema.raw).toEqual(payload);
  });

  it('should normalize the inner schema of a json schema multi format object', () => {
    // Given
    const payload = {
      schemaFormat: 'application/schema+json;version=draft-07',
      schema: { type: 'string', format: 'uuid' },
    };

    // When
    const schema = buildSchema({
      id: 'Id',
      payload,
      defaultDialect: 'asyncapi-schema',
      normalizeOptions: OPTIONS,
    });

    // Then
    expect(schema.dialect).toBe('json-schema-2020-12');
    expect(schema.normalized).toEqual({ type: 'string', format: 'uuid' });
  });

  it('should carry the name when one is given and omit it when none is', () => {
    // Given
    const payload = { type: 'string' };

    // When
    const named = buildSchema({
      id: 'Order',
      name: 'Order',
      payload,
      defaultDialect: 'json-schema-2020-12',
      normalizeOptions: OPTIONS,
    });
    const anonymous = buildSchema({
      id: 'inline-1',
      payload,
      defaultDialect: 'json-schema-2020-12',
      normalizeOptions: OPTIONS,
    });

    // Then
    expect(named.name).toBe('Order');
    expect(Object.hasOwn(anonymous, 'name')).toBe(false);
  });
});
