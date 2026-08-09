import { describe, expect, it } from 'vitest';
import {
  numberForFieldName,
  numberForFormat,
  splitFieldName,
  stringForFieldName,
  stringForFormat,
} from '../../src/index';

describe('splitFieldName', () => {
  it('should reduce every casing convention of one name to the same words', () => {
    // Given
    const names = ['orderId', 'order_id', 'order-id', 'OrderId', 'ORDER_ID'];

    // When
    const results = names.map((name) => splitFieldName(name).join('.'));

    // Then
    expect(new Set(results).size).toBe(1);
  });

  it('should split a run of capitals from the word that follows it', () => {
    // Given
    const name = 'createdAtUTCValue';

    // When
    const words = splitFieldName(name);

    // Then
    expect(words).toEqual(['created', 'at', 'utc', 'value']);
  });

  it('should produce no words for a name with nothing in it', () => {
    // Given
    const name = '___';

    // When
    const words = splitFieldName(name);

    // Then
    expect(words).toEqual([]);
  });
});

describe('stringForFieldName', () => {
  it('should reach the email entry from a compound name', () => {
    // Given
    const name = 'customerEmailAddress';

    // When
    const value = stringForFieldName(name);

    // Then
    expect(value).toBe('user@example.com');
  });

  it('should reach the id entry from a suffix word', () => {
    // Given
    const name = 'orderId';

    // When
    const value = stringForFieldName(name);

    // Then
    expect(value).toBe('example-id');
  });

  it('should produce nothing for a name the dictionary does not claim', () => {
    // Given
    const name = 'sprocketAlignment';

    // When
    const value = stringForFieldName(name);

    // Then
    expect(value).toBeUndefined();
  });

  it('should produce nothing at a position with no name', () => {
    // Given
    const name = undefined;

    // When
    const value = stringForFieldName(name);

    // Then
    expect(value).toBeUndefined();
  });
});

describe('numberForFieldName', () => {
  it('should produce a price for an amount field', () => {
    // Given
    const name = 'totalAmount';

    // When
    const value = numberForFieldName(name);

    // Then
    expect(value).toBe(19.99);
  });

  it('should produce nothing for a name the dictionary claims only as a string', () => {
    // Given
    const name = 'customerEmail';

    // When
    const value = numberForFieldName(name);

    // Then
    expect(value).toBeUndefined();
  });
});

describe('stringForFormat and numberForFormat', () => {
  it('should answer for every format in the tables and for nothing else', () => {
    // Given
    const known = ['date-time', 'uuid', 'ipv6', 'byte'];
    const unknown = 'sprocket';

    // When
    const answers = known.map((format) => stringForFormat(format));
    const missing = stringForFormat(unknown);

    // Then
    expect(answers.every((answer) => answer !== undefined)).toBe(true);
    expect(missing).toBeUndefined();
  });

  it('should give a fractional value for float and an integral one for int32', () => {
    // Given
    const formats = ['int32', 'float'];

    // When
    const values = formats.map((format) => numberForFormat(format));

    // Then
    expect(values).toEqual([1, 1.5]);
  });

  it('should produce nothing when no format is declared', () => {
    // Given
    const format = undefined;

    // When
    const values = [stringForFormat(format), numberForFormat(format)];

    // Then
    expect(values).toEqual([undefined, undefined]);
  });
});
