import { SerializationError } from '@openref/core';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_BODY_BYTES,
  payloadByteLength,
  serializeBody,
  utf8Length,
  type RunnerBody,
  type RunnerFile,
} from '../../src/index';

/**
 * The six body forms of SPEC 14.3, and every way one of them could be quietly wrong.
 *
 * WHAT IS ASSERTED HERE IS THE BYTES AND NOT THE INTENT. A multipart body is right or wrong by
 * whether a parser can read it, and the two ways to get that wrong both look fine from inside:
 * a bare line feed where the delimiter needs a CRLF, which a permissive parser accepts and a
 * strict one does not, and a file decoded through UTF-8 on its way into a string, which arrives
 * corrupted with a 200 to show for it. The round trip suite drives a real parser over the same
 * bodies; these cases pin the bytes so that a failure there has a place to point at.
 */

const OPTIONS = { boundary: 'TestBoundary', maxBodyBytes: DEFAULT_MAX_BODY_BYTES };

/** A file of known bytes, including two that are not valid UTF-8 on their own. */
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe]);

function file(): RunnerFile {
  return { fileName: 'logo.png', mediaType: 'image/png', bytes: PNG_BYTES };
}

/** The encoded body as text, for the cases where it is text. */
function textOf(body: string | Uint8Array): string {
  return typeof body === 'string' ? body : new TextDecoder().decode(body);
}

describe('utf8Length', () => {
  it('should count what an encoder would produce, without allocating it', () => {
    // Given one code point of each width, the last a surrogate pair
    const cases: readonly (readonly [string, number])[] = [
      ['a', 1],
      ['é', 2],
      ['€', 3],
      ['😀', 4],
      ['aé€😀', 10],
      ['', 0],
    ];

    // When
    const measured = cases.map(([text]) => utf8Length(text));

    // Then
    expect(measured).toEqual(cases.map(([, length]) => length));
    for (const [text] of cases) {
      expect(utf8Length(text)).toBe(new TextEncoder().encode(text).length);
    }
  });
});

describe('serializeBody, the text media types', () => {
  it('should send a JSON body as typed and name the media type it was sent as', () => {
    // Given
    const body: RunnerBody = { kind: 'text', text: '{"sku":"a"}' };

    // When
    const encoded = serializeBody('application/json', body, OPTIONS);

    // Then
    expect(encoded.body).toBe('{"sku":"a"}');
    expect(encoded.contentType).toBe('application/json');
  });

  it('should refuse a JSON body that is not JSON rather than let the server reject it', () => {
    // Given
    const body: RunnerBody = { kind: 'text', text: '{oops' };

    // When
    const encode = (): unknown => serializeBody('application/vnd.acme+json', body, OPTIONS);

    // Then, the structured suffix is JSON too, which is why this case uses one
    expect(encode).toThrow(SerializationError);
    expect(encode).toThrow(/not valid JSON/);
  });

  it('should send text/plain exactly as typed, including what JSON would refuse', () => {
    // Given a body that is not JSON and does not have to be
    const body: RunnerBody = { kind: 'text', text: 'order 42, please hurry' };

    // When
    const encoded = serializeBody('text/plain', body, OPTIONS);

    // Then
    expect(encoded.body).toBe('order 42, please hurry');
    expect(encoded.contentType).toBe('text/plain');
  });

  it('should validate ndjson line by line and name the line that is wrong', () => {
    // Given three documents, the second broken. The line number is the whole point: on four
    // hundred lines, "the body is not valid JSON" sends a reader to read all four hundred.
    const body: RunnerBody = { kind: 'text', text: '{"a":1}\n{"b":\n{"c":3}\n' };

    // When
    const encode = (): unknown => serializeBody('application/x-ndjson', body, OPTIONS);

    // Then
    expect(encode).toThrow(SerializationError);
    expect(encode).toThrow(/line 2/);
  });

  it('should accept a trailing newline in ndjson, which every editor writes', () => {
    // Given
    const body: RunnerBody = { kind: 'text', text: '{"a":1}\n{"b":2}\n' };

    // When
    const encoded = serializeBody('application/x-ndjson', body, OPTIONS);

    // Then
    expect(encoded.body).toBe('{"a":1}\n{"b":2}\n');
  });
});

describe('serializeBody, the form media types', () => {
  it('should encode named fields as a urlencoded body, with a space as a plus', () => {
    // Given, chosen: the media type's name is the format, and its definition says a space is a
    // plus. SPEC 14.2 writes %20 in a query string, and the two are different documents.
    const body: RunnerBody = {
      kind: 'fields',
      fields: [
        { kind: 'text', name: 'sku', value: 'a b' },
        { kind: 'text', name: 'note', value: 'ø&=' },
      ],
    };

    // When
    const encoded = serializeBody('application/x-www-form-urlencoded', body, OPTIONS);

    // Then
    expect(encoded.body).toBe('sku=a+b&note=%C3%B8%26%3D');
    expect(encoded.contentType).toBe('application/x-www-form-urlencoded');
  });

  it('should refuse a file in a urlencoded body and name the media type that carries one', () => {
    // Given
    const body: RunnerBody = {
      kind: 'fields',
      fields: [{ kind: 'file', name: 'avatar', file: file() }],
    };

    // When
    const encode = (): unknown => serializeBody('application/x-www-form-urlencoded', body, OPTIONS);

    // Then
    expect(encode).toThrow(SerializationError);
    expect(encode).toThrow(/multipart\/form-data/);
  });

  it('should build a multipart body with a file part beside a JSON part', () => {
    // Given the case SPEC 14.3 names by itself: a file and a JSON part in one body
    const body: RunnerBody = {
      kind: 'fields',
      fields: [
        {
          kind: 'text',
          name: 'metadata',
          value: '{"title":"logo"}',
          contentType: 'application/json',
        },
        { kind: 'file', name: 'file', file: file() },
      ],
    };

    // When
    const encoded = serializeBody('multipart/form-data', body, OPTIONS);
    const text = textOf(encoded.body);

    // Then, the content type carries the boundary, because a multipart body without one cannot
    // be parsed at all
    expect(encoded.contentType).toBe('multipart/form-data; boundary=TestBoundary');

    // And the framing is CRLF, which is what a strict parser scans for
    expect(text).toContain('--TestBoundary\r\nContent-Disposition: form-data; name="metadata"');
    expect(text).toContain('Content-Type: application/json\r\n\r\n{"title":"logo"}\r\n');
    expect(text).toContain('name="file"; filename="logo.png"');
    expect(text).toContain('Content-Type: image/png');
    expect(text.endsWith('--TestBoundary--\r\n')).toBe(true);
    expect(text).not.toContain(
      '\n--TestBoundary\r\nContent-Disposition: form-data; name="metadata"\n',
    );
  });

  it('should carry the file bytes unchanged, including the ones UTF-8 cannot represent', () => {
    // Given, the plant that makes this suite worth having: a string body would have replaced
    // 0xff and 0xfe with U+FFFD and uploaded a corrupted file with a 200 to show for it.
    const body: RunnerBody = {
      kind: 'fields',
      fields: [{ kind: 'file', name: 'file', file: file() }],
    };

    // When
    const encoded = serializeBody('multipart/form-data', body, OPTIONS);

    // Then
    expect(encoded.body).toBeInstanceOf(Uint8Array);
    const bytes = encoded.body as Uint8Array;
    const at = bytes.indexOf(0x89);
    expect([...bytes.slice(at, at + PNG_BYTES.length)]).toEqual([...PNG_BYTES]);
  });

  it('should escape a quote in a file name rather than end the header early', () => {
    // Given a legal file name that carries the character which closes the parameter
    const body: RunnerBody = {
      kind: 'fields',
      fields: [
        {
          kind: 'file',
          name: 'file',
          file: { fileName: 'a"b\r\n.txt', mediaType: 'text/plain', bytes: new Uint8Array([1]) },
        },
      ],
    };

    // When
    const encoded = serializeBody('multipart/form-data', body, OPTIONS);
    const text = textOf(encoded.body);

    // Then
    expect(text).toContain('filename="a\\"b  .txt"');
  });

  it('should refuse a body whose part contains the boundary that separates the parts', () => {
    // Given the failure that arrives as a 200: a payload holding the delimiter ends the upload
    // early, and everything after it is read as another part.
    const body: RunnerBody = {
      kind: 'fields',
      fields: [{ kind: 'text', name: 'note', value: 'before\r\n--TestBoundary\r\nafter' }],
    };

    // When
    const encode = (): unknown => serializeBody('multipart/form-data', body, OPTIONS);

    // Then
    expect(encode).toThrow(SerializationError);
    expect(encode).toThrow(/boundary/);
  });

  it('should refuse named fields at a media type that has no field encoding', () => {
    // Given
    const body: RunnerBody = {
      kind: 'fields',
      fields: [{ kind: 'text', name: 'sku', value: 'a' }],
    };

    // When
    const encode = (): unknown => serializeBody('application/json', body, OPTIONS);

    // Then
    expect(encode).toThrow(SerializationError);
    expect(encode).toThrow(/no named fields/);
  });

  it('should refuse one typed value at a media type that is made of fields', () => {
    // Given
    const body: RunnerBody = { kind: 'text', text: 'sku=a' };

    // When
    const encode = (): unknown => serializeBody('multipart/form-data', body, OPTIONS);

    // Then
    expect(encode).toThrow(SerializationError);
    expect(encode).toThrow(/named fields/);
  });
});

describe('serializeBody, the binary media type', () => {
  it('should send the file bytes and label them with the declared media type', () => {
    // Given, chosen: the document says what the endpoint accepts, so a reader who picked a PNG
    // for an octet stream body is sending octets.
    const body: RunnerBody = { kind: 'binary', file: file() };

    // When
    const encoded = serializeBody('application/octet-stream', body, OPTIONS);

    // Then
    expect(encoded.body).toBeInstanceOf(Uint8Array);
    expect([...(encoded.body as Uint8Array)]).toEqual([...PNG_BYTES]);
    expect(encoded.contentType).toBe('application/octet-stream');
    expect(encoded.byteLength).toBe(PNG_BYTES.length);
  });
});

describe('maxBodyBytes', () => {
  it('should refuse a body larger than the limit before building any of it', () => {
    // Given ten megabytes, which is the case T027 names. `payloadByteLength` is what the refusal
    // reads, and it is computed from the length that is already known: nothing is concatenated,
    // so the tab is still answering when the message appears.
    const bytes = new Uint8Array(10 * 1024 * 1024);
    const body: RunnerBody = {
      kind: 'binary',
      file: { fileName: 'big.bin', mediaType: 'application/octet-stream', bytes },
    };

    // When
    const encode = (): unknown => serializeBody('application/octet-stream', body, OPTIONS);

    // Then
    expect(payloadByteLength(body)).toBe(10 * 1024 * 1024);
    expect(encode).toThrow(SerializationError);
    expect(encode).toThrow(/maxBodyBytes/);
  });

  it('should refuse a body that fits by payload and is over once the framing is added', () => {
    // Given a limit exactly on the payload, so only the delimiter and the headers push it over.
    // This is the second of the two checks, and it is why there are two: the first is a lower
    // bound and this is the number that actually goes on the wire.
    const value = 'x'.repeat(64);
    const body: RunnerBody = {
      kind: 'fields',
      fields: [{ kind: 'text', name: 'note', value }],
    };

    // When
    const encode = (): unknown =>
      serializeBody('multipart/form-data', body, { ...OPTIONS, maxBodyBytes: value.length + 4 });

    // Then
    expect(payloadByteLength(body)).toBe(value.length + 4);
    expect(encode).toThrow(/over the/);
  });

  it('should send a body that fits, so the limit is a limit rather than a refusal', () => {
    // Given, the control for the two cases above: an assertion that something is refused is worth
    // nothing without one that the same path admits what it should.
    const body: RunnerBody = { kind: 'text', text: '{"a":1}' };

    // When
    const encoded = serializeBody('application/json', body, { ...OPTIONS, maxBodyBytes: 7 });

    // Then
    expect(encoded.byteLength).toBe(7);
  });
});
