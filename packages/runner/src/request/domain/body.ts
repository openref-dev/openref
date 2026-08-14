/**
 * The six body forms of SPEC 14.3, and the bytes each one puts on the wire.
 *
 * THREE EDITORS RATHER THAN SIX ENCODERS, and that is the whole shape of this file. A reader
 * fills in one of three things: text they type, a set of named fields, or a file. What varies per
 * media type is not what is asked of the reader but how the answer is encoded, so `application/
 * json`, `text/plain` and `application/x-ndjson` are one editor with three validations, and
 * `x-www-form-urlencoded` and `multipart/form-data` are one editor with two encodings.
 *
 * THE RUNNER CLASSIFIES NOTHING. Which editor an operation gets is read off the request body
 * schema by `@openref/vue`, because the schema is what says whether a property is a file and what
 * a part's content type is, and this package never sees a schema. What is refused here is only
 * what genuinely cannot be encoded: fields at a media type that defines no field encoding, and a
 * file part inside a urlencoded body. A refusal list built from a guess at the editor would
 * refuse a request the document describes.
 *
 * THE SIZE IS CHECKED BEFORE THE BODY IS BUILT, WHICH IS THE `maxBodyBytes` PROMISE. A ten
 * megabyte file refused after being concatenated into a multipart body has already been copied
 * twice, and on a page that is a freeze rather than a message. So the payloads are measured
 * first, from lengths that are already known, and the encoded body is measured again afterwards
 * because the framing is not free either. The first check is what keeps the tab alive; the second
 * is what makes the number honest.
 */

import { ErrorCode, SerializationError } from '@openref/core';

/**
 * Bytes a body is made of.
 *
 * `Uint8Array<ArrayBuffer>` AND NOT THE DEFAULT `Uint8Array`, which is over `ArrayBufferLike` and
 * therefore includes a `SharedArrayBuffer`. A request body cannot be shared memory, and the
 * platform's own `BodyInit` says so: with the loose type, the browser's real `fetch` stops being
 * assignable to `FetchLike` and every caller composing one fails to compile. That is the same
 * lesson the transport already carries about `AbortSignal`, one type over: declare the type the
 * real implementation can satisfy.
 */
export type BodyBytes = Uint8Array<ArrayBuffer>;

/** A file the reader chose, as bytes rather than as a browser `File`. */
export interface RunnerFile {
  /** Name sent in the part's `filename`, and never a path. */
  readonly fileName: string;
  /** Media type of the file itself, which is the part's content type in a multipart body. */
  readonly mediaType: string;
  readonly bytes: BodyBytes;
}

/**
 * One named field of a form body.
 *
 * `contentType` is on the text member and not on both, because a file carries its own. It is
 * what makes "a JSON part alongside a file part" expressible: the part is text the reader typed
 * and the document says it is `application/json`, so the part is labelled and a server that
 * routes on part content types accepts it.
 */
export type RunnerBodyField =
  | {
      readonly kind: 'text';
      readonly name: string;
      readonly value: string;
      readonly contentType?: string;
    }
  | { readonly kind: 'file'; readonly name: string; readonly file: RunnerFile };

/** What the reader supplied, in one of the three forms a console can ask for. */
export type RunnerBody =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'fields'; readonly fields: readonly RunnerBodyField[] }
  | { readonly kind: 'binary'; readonly file: RunnerFile };

/** Which control a media type is filled in with, per SPEC 14.3. */
export type BodyEditor = 'text' | 'fields' | 'binary';

/**
 * How many bytes of request body the console will build.
 *
 * IT BOUNDS WHAT IS BUILT, NOT WHAT COULD BE UPLOADED. The body is assembled in the page's own
 * memory before a byte is sent, so this is the same kind of ceiling as the response limit beside
 * it and is set for the same reason: a documentation console that builds a hundred megabyte body
 * has stopped being a documentation console and has become a tab that stopped answering. An
 * operator who knows their endpoint takes more says so with `maxBodyBytes`.
 */
export const DEFAULT_MAX_BODY_BYTES = 8 * 1024 * 1024;

/** How many bytes a string takes as UTF-8, without allocating them. */
export function utf8Length(text: string): number {
  let bytes = 0;

  for (let at = 0; at < text.length; at += 1) {
    const code = text.charCodeAt(at);

    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      // A surrogate pair is one code point of four bytes, and the low half is stepped over so it
      // is not counted again as three.
      bytes += 4;
      at += 1;
    } else bytes += 3;
  }

  return bytes;
}

/** Whether a media type is one the runner sends as JSON, which is JSON and its `+json` suffixes. */
export function isJsonMediaType(mediaType: string): boolean {
  return /^application\/(?:[\w.+-]+\+)?json\b/i.test(mediaType.trim());
}

/** Whether a media type is newline delimited JSON, which is validated line by line. */
export function isNdjsonMediaType(mediaType: string): boolean {
  return /^application\/(?:x-)?nd[-]?json\b/i.test(mediaType.trim());
}

/** Whether a media type carries named fields as a url encoded query string. */
export function isFormUrlencoded(mediaType: string): boolean {
  return /^application\/x-www-form-urlencoded\b/i.test(mediaType.trim());
}

/** Whether a media type carries named parts, each with its own headers. */
export function isMultipart(mediaType: string): boolean {
  return /^multipart\//i.test(mediaType.trim());
}

/**
 * Whether a media type is text a reader can be asked to type.
 *
 * BY RULE AND NOT BY LIST, so a vendor type is not refused for being unnamed.
 * `application/vnd.acme.orders+json` is JSON by its structured suffix, and a console that asked
 * for a file there would be asking the reader to save their JSON to disk first.
 */
export function isTextualMediaType(mediaType: string): boolean {
  const type = mediaType.trim().toLowerCase();

  if (type.startsWith('text/')) return true;
  if (isJsonMediaType(type) || isNdjsonMediaType(type)) return true;

  return /^application\/(?:[\w.-]+\+)?(?:xml|yaml|graphql)\b/i.test(type);
}

/** A body, encoded, with the content type that describes it. */
export interface SerializedBody {
  /** Text for a body that is text, bytes for one that is not. */
  readonly body: string | BodyBytes;
  /** What the `Content-Type` header has to say, boundary included for a multipart body. */
  readonly contentType: string;
  /** Size on the wire, which is what `maxBodyBytes` was checked against. */
  readonly byteLength: number;
}

/** How a body is built: the boundary to use, and how much may be built. */
export interface BodySerializationOptions {
  /** Multipart boundary, without the leading dashes. Supplied so a test can pin the bytes. */
  readonly boundary: string;
  readonly maxBodyBytes: number;
}

function refuse(message: string, context: Record<string, unknown>, cause?: Error): never {
  throw new SerializationError(message, ErrorCode.RUN_SERIALIZATION_FAILED, cause, context);
}

function tooLarge(measured: number, limit: number, mediaType: string): never {
  refuse(
    `the request body is ${String(measured)} bytes, over the ${String(limit)} this console will ` +
      'build. Send a smaller body, or raise maxBodyBytes where the runner is composed',
    { mediaType, measured, limit },
  );
}

/**
 * The payload bytes of a body, before any framing.
 *
 * WHAT IT IS FOR IS THE REFUSAL AND NOT THE HEADER. It is a lower bound on the encoded size,
 * computed from lengths that are already known, so a file too large to build a body from is
 * refused without the body ever being built.
 *
 * @param body - What the reader supplied
 * @returns Bytes the payloads alone come to
 */
export function payloadByteLength(body: RunnerBody): number {
  if (body.kind === 'text') return utf8Length(body.text);
  if (body.kind === 'binary') return body.file.bytes.length;

  return body.fields.reduce(
    (total, field) =>
      total +
      utf8Length(field.name) +
      (field.kind === 'text' ? utf8Length(field.value) : field.file.bytes.length),
    0,
  );
}

/** Validates a JSON body, naming the media type it was refused under. */
function assertJson(text: string, mediaType: string): void {
  try {
    JSON.parse(text);
  } catch (cause) {
    refuse(
      'the request body is not valid JSON',
      { mediaType },
      cause instanceof Error ? cause : undefined,
    );
  }
}

/**
 * Validates a newline delimited JSON body, one document per line.
 *
 * THE LINE NUMBER IS IN THE MESSAGE, because the whole point of the format is that there are many
 * documents and one of them is wrong. "the request body is not valid JSON" over four hundred
 * lines is a message that sends a reader to read all four hundred.
 *
 * A BLANK LINE IS SKIPPED RATHER THAN REFUSED. A trailing newline is how every editor ends a
 * file, and ndjson readers ignore empty lines; refusing one would refuse the ordinary case.
 */
function assertNdjson(text: string, mediaType: string): void {
  const lines = text.split('\n');

  for (const [index, line] of lines.entries()) {
    if (line.trim() === '') continue;

    try {
      JSON.parse(line);
    } catch (cause) {
      refuse(
        `line ${String(index + 1)} of the request body is not valid JSON, and ${mediaType} is one JSON document per line`,
        { mediaType, line: index + 1 },
        cause instanceof Error ? cause : undefined,
      );
    }
  }
}

/**
 * Encodes one name or value the way `application/x-www-form-urlencoded` defines it.
 *
 * A SPACE IS `+` HERE AND `%20` IN A QUERY STRING, and the difference is deliberate rather than
 * an inconsistency with SPEC 14.2. This is the media type whose name is the format, and its
 * definition says a space is a plus; a server parsing a urlencoded body with a form parser
 * decodes both, but the one that is right for the format is the one written here.
 *
 * EXPORTED SINCE T028, because a token endpoint takes a urlencoded body and RFC 6749 says so.
 * The alternative was a second encoder in the auth module, which is how two answers to what a
 * space is get into one package.
 *
 * @param value - A name or a value, as it was typed
 * @returns The encoded form
 *
 * @example
 * formEncode('a b'); // 'a+b'
 */
export function formEncode(value: string): string {
  return encodeURIComponent(value)
    .replace(/%20/g, '+')
    .replace(/[!'()*]/g, (character) => {
      return `%${character.charCodeAt(0).toString(16).toUpperCase()}`;
    });
}

/** The `Content-Disposition` of one part, with the quoting rule that keeps a server parsing. */
function disposition(name: string, fileName?: string): string {
  // A QUOTE AND A LINE BREAK ARE THE TWO CHARACTERS THAT END A HEADER EARLY, and a file name is
  // the reader's, not ours. They are escaped rather than the name refused, because a file called
  // `a"b.txt` is a legal file and the reader chose it deliberately or not at all.
  const escape = (value: string): string =>
    value
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/[\r\n]/g, ' ');

  const base = `Content-Disposition: form-data; name="${escape(name)}"`;

  return fileName === undefined ? base : `${base}; filename="${escape(fileName)}"`;
}

/** Concatenates encoded pieces into one buffer. */
function concat(pieces: readonly Uint8Array[]): BodyBytes {
  const total = pieces.reduce((sum, piece) => sum + piece.length, 0);
  const out = new Uint8Array(total);
  let at = 0;

  for (const piece of pieces) {
    out.set(piece, at);
    at += piece.length;
  }

  return out;
}

/**
 * Builds a `multipart/form-data` body with the given boundary.
 *
 * CRLF EVERYWHERE, because RFC 2046 says the delimiter is a CRLF followed by the boundary, and a
 * parser that scans for exactly that finds nothing in a body joined with bare line feeds. The one
 * defect of this kind that survives testing is the one where a permissive parser accepts it and a
 * stricter one does not.
 *
 * THE BOUNDARY IS CHECKED AGAINST THE PAYLOADS, not assumed unique. A part whose bytes contain
 * the delimiter ends the body early and everything after it is read as another part, which is a
 * corrupted upload that arrives with a 200. It is refused rather than worked around, because the
 * caller supplies the boundary and can supply another.
 */
function encodeMultipart(
  mediaType: string,
  fields: readonly RunnerBodyField[],
  boundary: string,
): { body: BodyBytes; contentType: string } {
  const encoder = new TextEncoder();
  const delimiter = `--${boundary}`;
  const pieces: Uint8Array[] = [];

  for (const field of fields) {
    const headers =
      field.kind === 'file'
        ? [disposition(field.name, field.file.fileName), `Content-Type: ${field.file.mediaType}`]
        : [
            disposition(field.name),
            ...(field.contentType === undefined ? [] : [`Content-Type: ${field.contentType}`]),
          ];

    pieces.push(encoder.encode(`${delimiter}\r\n${headers.join('\r\n')}\r\n\r\n`));
    pieces.push(field.kind === 'file' ? field.file.bytes : encoder.encode(field.value));
    pieces.push(encoder.encode('\r\n'));
  }

  pieces.push(encoder.encode(`${delimiter}--\r\n`));

  const bytes = concat(pieces);
  assertBoundaryUnused(bytes, encoder.encode(`\r\n${delimiter}`), fields, boundary, mediaType);

  return { body: bytes, contentType: `${mediaType}; boundary=${boundary}` };
}

/**
 * Refuses a body whose payload carries the delimiter that is supposed to separate its parts.
 *
 * Counted rather than searched for once: the delimiter appears before every part and once at the
 * end, so the number of occurrences is known, and one more than that means a payload contains it.
 */
function assertBoundaryUnused(
  bytes: Uint8Array,
  delimiter: Uint8Array,
  fields: readonly RunnerBodyField[],
  boundary: string,
  mediaType: string,
): void {
  // The first delimiter of the body has no CRLF before it, so what is counted is the ones that do:
  // one before every part after the first, and one before the closing delimiter.
  const expected = fields.length;
  let found = 0;

  outer: for (let at = 0; at + delimiter.length <= bytes.length; at += 1) {
    for (let step = 0; step < delimiter.length; step += 1) {
      if (bytes[at + step] !== delimiter[step]) continue outer;
    }
    found += 1;
  }

  if (found <= expected) return;

  refuse(
    'a part of this multipart body contains the boundary that separates the parts, so a server ' +
      'would read the upload as ending early. Sending it again picks a different boundary',
    { mediaType, boundary },
  );
}

/**
 * Encodes what the reader supplied for the media type the request is sent with.
 *
 * @param mediaType - Media type the body is declared with
 * @param body - What the reader supplied
 * @param options - Boundary for a multipart body, and how much may be built
 * @returns The bytes or text to send, and the content type that describes them
 * @throws {SerializationError} When the form cannot be encoded at that media type, when the body
 *   is not valid for it, or when it is larger than `maxBodyBytes`
 *
 * @example
 * const encoded = serializeBody('application/json', { kind: 'text', text: '{}' }, options);
 */
export function serializeBody(
  mediaType: string,
  body: RunnerBody,
  options: BodySerializationOptions,
): SerializedBody {
  const declared = mediaType.trim();

  // THE CHEAP CHECK FIRST AND ON THE PAYLOADS ALONE. Everything below allocates, and a body over
  // the limit is refused before any of it runs.
  const payload = payloadByteLength(body);
  if (payload > options.maxBodyBytes) tooLarge(payload, options.maxBodyBytes, declared);

  const encoded = encodeFor(declared, body, options.boundary);
  const byteLength =
    typeof encoded.body === 'string' ? utf8Length(encoded.body) : encoded.body.length;

  // AND THE EXACT CHECK AFTER, because the framing is not free: a multipart body carries a
  // delimiter and two headers per part, and a body that fits by payload can be over by framing.
  if (byteLength > options.maxBodyBytes) tooLarge(byteLength, options.maxBodyBytes, declared);

  return { ...encoded, byteLength };
}

/** Encodes the body without measuring it, which `serializeBody` does on both sides of this. */
function encodeFor(
  mediaType: string,
  body: RunnerBody,
  boundary: string,
): { body: string | BodyBytes; contentType: string } {
  const fieldMediaType = isFormUrlencoded(mediaType) || isMultipart(mediaType);

  if (body.kind === 'fields') {
    if (!fieldMediaType) {
      refuse(
        `media type '${mediaType}' carries no named fields, so a form cannot be sent to it. ` +
          'x-www-form-urlencoded and multipart/form-data are the two that can',
        { mediaType },
      );
    }

    if (isMultipart(mediaType)) return encodeMultipart(mediaType, body.fields, boundary);

    const file = body.fields.find((field) => field.kind === 'file');
    if (file !== undefined) {
      refuse(
        `field '${file.name}' is a file, and ${mediaType} has no way to carry one. A file part ` +
          'needs multipart/form-data, which this operation would have to declare',
        { mediaType, field: file.name },
      );
    }

    const text = body.fields
      .map((field) =>
        field.kind === 'text' ? `${formEncode(field.name)}=${formEncode(field.value)}` : '',
      )
      .join('&');

    return { body: text, contentType: mediaType };
  }

  if (fieldMediaType) {
    refuse(
      `media type '${mediaType}' is a form, so it is sent as named fields rather than as one ` +
        'value. The console asks for the fields the schema declares',
      { mediaType },
    );
  }

  if (body.kind === 'binary') {
    // THE DECLARED TYPE WINS OVER THE FILE'S. The document says what the endpoint accepts, and a
    // reader who picked a PNG for an `application/octet-stream` body is sending octets.
    return { body: body.file.bytes, contentType: mediaType };
  }

  if (isNdjsonMediaType(mediaType)) assertNdjson(body.text, mediaType);
  else if (isJsonMediaType(mediaType)) assertJson(body.text, mediaType);

  return { body: body.text, contentType: mediaType };
}
