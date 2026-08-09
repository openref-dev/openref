import { describe, expect, it } from 'vitest';
import { ErrorCode, NormalizeError, parseSpecification } from '../../src/index';

describe('parseSpecification', () => {
  it('should parse a JSON document', () => {
    // Given
    const text = '{"openapi":"3.1.0","info":{"title":"API","version":"1.0.0"}}';

    // When
    const parsed = parseSpecification(text);

    // Then
    expect(parsed).toEqual({ openapi: '3.1.0', info: { title: 'API', version: '1.0.0' } });
  });

  it('should parse a YAML document', () => {
    // Given
    const text = 'openapi: 3.1.0\ninfo:\n  title: API\n  version: 1.0.0\n';

    // When
    const parsed = parseSpecification(text);

    // Then
    expect(parsed).toEqual({ openapi: '3.1.0', info: { title: 'API', version: '1.0.0' } });
  });

  it('should read a JSON and a YAML form of the same document identically', () => {
    // Given
    const json = '{"a":[1,2],"b":{"c":true}}';
    const yaml = 'a:\n  - 1\n  - 2\nb:\n  c: true\n';

    // When
    const parsed = [parseSpecification(json), parseSpecification(yaml)];

    // Then
    expect(parsed[0]).toEqual(parsed[1]);
  });

  it('should keep a YAML string that looks like a version as a string', () => {
    // Given
    const text = 'openapi: "3.1.0"\n';

    // When
    const parsed = parseSpecification(text);

    // Then
    expect(parsed).toEqual({ openapi: '3.1.0' });
  });

  it('should reject empty input', () => {
    // Given
    const texts = ['', '   \n  '];

    // When
    const outcomes = texts.map((text) => {
      try {
        parseSpecification(text);
        return 'accepted';
      } catch (error) {
        return error instanceof NormalizeError ? error.code : 'wrong-type';
      }
    });

    // Then
    expect(outcomes).toEqual([ErrorCode.NORM_DOCUMENT_INVALID, ErrorCode.NORM_DOCUMENT_INVALID]);
  });

  it('should reject text that is neither JSON nor YAML and keep the parser error as the cause', () => {
    // Given
    const text = '{ "unclosed": ';

    // When
    let error: unknown;
    try {
      parseSpecification(text, { source: 'openapi.json' });
    } catch (caught) {
      error = caught;
    }

    // Then
    expect(error).toBeInstanceOf(NormalizeError);
    expect(error).toMatchObject({ code: ErrorCode.NORM_DOCUMENT_INVALID });
    expect((error as NormalizeError).message).toContain('openapi.json');
    expect((error as NormalizeError).cause).toBeInstanceOf(Error);
  });

  it('should reject a document that parses to nothing', () => {
    // Given
    const text = '# only a comment\n';

    // When
    const act = (): unknown => parseSpecification(text);

    // Then
    expect(act).toThrow(/parsed to nothing/);
  });

  it('should reject malformed YAML', () => {
    // Given
    const text = 'a:\n  - b\n c: broken indentation\n';

    // When
    const act = (): unknown => parseSpecification(text);

    // Then
    expect(act).toThrow(NormalizeError);
  });
});
