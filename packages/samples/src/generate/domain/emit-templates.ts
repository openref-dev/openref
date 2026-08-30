/**
 * The six level 2 languages of SPEC 18: Go, PHP, Java, C#, Ruby and Rust.
 *
 * A TEMPLATE RENDERS A TEXT BODY AND REFUSES A BYTE ONE, and the refusal is the honest half of
 * this file. A multipart form and a binary upload reach the plan as bytes; writing six multipart
 * encoders by hand would put six untested body builders into the one place SPEC 18 exists to keep
 * a single answer, and a template that printed a comment where the body belongs would be code a
 * reader copies and watches fail. The refusal names the three tabs that do carry it.
 *
 * EACH TEMPLATE SETS THE CONTENT TYPE THE WAY ITS CLIENT DEMANDS RATHER THAN THE WAY THE OTHERS
 * DO. .NET refuses a content type on the request headers and takes it on the content, and its
 * `StringContent` convenience constructor appends a charset the runner never sent, so the sample
 * parses the runner's own value onto the content instead. That is the whole discipline of this
 * package in one line: the same bytes, spelled as each client spells them.
 */

import { quotePhp, quoteRuby, quoteRust, quoteUnicode } from './literals';
import type { HeaderPair } from './plan-parts';
import { hasByteBody, headersOf, textBodyOf } from './plan-parts';
import type { SampleRequest } from './sample-request';
import { BYTE_BODY_REFUSAL, type EmitOutcome } from './languages';

/** The `Net::HTTP` request class per method, for the methods Ruby ships one for. */
const RUBY_REQUEST_CLASSES: Readonly<Record<string, string>> = {
  GET: 'Get',
  HEAD: 'Head',
  POST: 'Post',
  PUT: 'Put',
  PATCH: 'Patch',
  DELETE: 'Delete',
  OPTIONS: 'Options',
  TRACE: 'Trace',
};

/** The `reqwest::Method` constants, for the methods the crate names. */
const RUST_METHODS: readonly string[] = [
  'GET',
  'POST',
  'PUT',
  'DELETE',
  'HEAD',
  'OPTIONS',
  'CONNECT',
  'PATCH',
  'TRACE',
];

/** The content type of a request, found under whatever spelling its producer used. */
function contentTypeHeader(request: SampleRequest): HeaderPair | null {
  return headersOf(request).find(([name]) => name.toLowerCase() === 'content-type') ?? null;
}

/** Every header except the content type, which two of these clients attach to the body. */
function headersExceptContentType(request: SampleRequest): readonly HeaderPair[] {
  return headersOf(request).filter(([name]) => name.toLowerCase() !== 'content-type');
}

/** The refusal every template shares, so the six cannot word it six ways. */
function refuseBytes(request: SampleRequest): EmitOutcome | null {
  return hasByteBody(request) ? { kind: 'refused', reason: BYTE_BODY_REFUSAL } : null;
}

/**
 * Emits the Go sample, over `net/http`.
 *
 * @param request - The request the runner would send
 * @returns The snippet, or the refusal
 */
export function emitGo(request: SampleRequest): EmitOutcome {
  const refused = refuseBytes(request);
  if (refused !== null) return refused;

  const text = textBodyOf(request);
  const imports =
    text === null
      ? ['import "net/http"', '']
      : ['import (', '\t"net/http"', '\t"strings"', ')', ''];

  const reader = text === null ? 'nil' : `strings.NewReader(${quoteUnicode(text)})`;
  const lines = [
    `req, _ := http.NewRequest(${quoteUnicode(request.plan.method)}, ` +
      `${quoteUnicode(request.plan.url)}, ${reader})`,
    ...headersOf(request).map(
      ([name, value]) => `req.Header.Set(${quoteUnicode(name)}, ${quoteUnicode(value)})`,
    ),
    '',
    'resp, err := http.DefaultClient.Do(req)',
  ];

  return { kind: 'source', source: [...imports, ...lines].join('\n') };
}

/**
 * Emits the PHP sample, over the cURL extension.
 *
 * @param request - The request the runner would send
 * @returns The snippet, or the refusal
 */
export function emitPhp(request: SampleRequest): EmitOutcome {
  const refused = refuseBytes(request);
  if (refused !== null) return refused;

  const headers = headersOf(request);
  const lines = [
    `$ch = curl_init(${quotePhp(request.plan.url)});`,
    `curl_setopt($ch, CURLOPT_CUSTOMREQUEST, ${quotePhp(request.plan.method)});`,
    'curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);',
  ];

  if (headers.length > 0) {
    const entries = headers
      .map(([name, value]) => `    ${quotePhp(`${name}: ${value}`)},`)
      .join('\n');
    lines.push(`curl_setopt($ch, CURLOPT_HTTPHEADER, [\n${entries}\n]);`);
  }

  const text = textBodyOf(request);
  if (text !== null) lines.push(`curl_setopt($ch, CURLOPT_POSTFIELDS, ${quotePhp(text)});`);

  lines.push('', '$response = curl_exec($ch);', 'curl_close($ch);');

  return { kind: 'source', source: lines.join('\n') };
}

/**
 * Emits the Java sample, over `java.net.http`.
 *
 * @param request - The request the runner would send
 * @returns The snippet, or the refusal
 */
export function emitJava(request: SampleRequest): EmitOutcome {
  const refused = refuseBytes(request);
  if (refused !== null) return refused;

  const text = textBodyOf(request);
  const publisher =
    text === null
      ? 'HttpRequest.BodyPublishers.noBody()'
      : `HttpRequest.BodyPublishers.ofString(${quoteUnicode(text)})`;

  const lines = [
    'HttpRequest request = HttpRequest.newBuilder()',
    `    .uri(URI.create(${quoteUnicode(request.plan.url)}))`,
    ...headersOf(request).map(
      ([name, value]) => `    .header(${quoteUnicode(name)}, ${quoteUnicode(value)})`,
    ),
    `    .method(${quoteUnicode(request.plan.method)}, ${publisher})`,
    '    .build();',
    '',
    'HttpResponse<String> response = HttpClient.newHttpClient()',
    '    .send(request, HttpResponse.BodyHandlers.ofString());',
  ];

  return { kind: 'source', source: lines.join('\n') };
}

/**
 * Emits the C# sample, over `HttpClient`.
 *
 * THE ONE REFUSAL THAT IS NOT ABOUT BYTES IS HERE. .NET attaches a content type to the content and
 * a request with no content has none to attach it to, so a document that declares a `Content-Type`
 * header parameter on an operation with no body describes something this client cannot express.
 * Adding an empty content instead would send a `Content-Length: 0` the runner does not.
 *
 * @param request - The request the runner would send
 * @returns The snippet, or the refusal
 */
export function emitCsharp(request: SampleRequest): EmitOutcome {
  const refused = refuseBytes(request);
  if (refused !== null) return refused;

  const text = textBodyOf(request);
  const contentType = contentTypeHeader(request);
  if (text === null && contentType !== null) {
    return {
      kind: 'refused',
      reason:
        'this request declares a content type and sends no body, and the .NET client carries a ' +
        'content type on the body alone',
    };
  }

  const lines = [
    'using var client = new HttpClient();',
    `using var request = new HttpRequestMessage(new HttpMethod(` +
      `${quoteUnicode(request.plan.method)}), ${quoteUnicode(request.plan.url)});`,
    ...headersExceptContentType(request).map(
      ([name, value]) => `request.Headers.Add(${quoteUnicode(name)}, ${quoteUnicode(value)});`,
    ),
  ];

  if (text !== null) {
    lines.push(`request.Content = new StringContent(${quoteUnicode(text)});`);
    if (contentType !== null) {
      lines.push(
        `request.Content.Headers.ContentType = MediaTypeHeaderValue.Parse(` +
          `${quoteUnicode(contentType[1])});`,
      );
    }
  }

  lines.push('', 'var response = await client.SendAsync(request);');

  return { kind: 'source', source: lines.join('\n') };
}

/**
 * Emits the Ruby sample, over `net/http`.
 *
 * @param request - The request the runner would send
 * @returns The snippet, or the refusal
 */
export function emitRuby(request: SampleRequest): EmitOutcome {
  const refused = refuseBytes(request);
  if (refused !== null) return refused;

  const named = RUBY_REQUEST_CLASSES[request.plan.method];
  const construct =
    named === undefined
      ? `Net::HTTPGenericRequest.new(${quoteRuby(request.plan.method)}, true, true, uri)`
      : `Net::HTTP::${named}.new(uri)`;

  const lines = [
    'require "net/http"',
    'require "uri"',
    '',
    `uri = URI(${quoteRuby(request.plan.url)})`,
    `request = ${construct}`,
    ...headersOf(request).map(
      ([name, value]) => `request[${quoteRuby(name)}] = ${quoteRuby(value)}`,
    ),
  ];

  const text = textBodyOf(request);
  if (text !== null) lines.push(`request.body = ${quoteRuby(text)}`);

  lines.push(
    '',
    'response = Net::HTTP.start(uri.hostname, uri.port, use_ssl: uri.scheme == "https") do |http|',
    '  http.request(request)',
    'end',
  );

  return { kind: 'source', source: lines.join('\n') };
}

/**
 * Emits the Rust sample, over `reqwest`.
 *
 * @param request - The request the runner would send
 * @returns The snippet, or the refusal
 */
export function emitRust(request: SampleRequest): EmitOutcome {
  const refused = refuseBytes(request);
  if (refused !== null) return refused;

  const method = RUST_METHODS.includes(request.plan.method)
    ? `reqwest::Method::${request.plan.method}`
    : `reqwest::Method::from_bytes(${quoteRust(request.plan.method)}.as_bytes())?`;

  const lines = [
    'let client = reqwest::Client::new();',
    'let response = client',
    `    .request(${method}, ${quoteRust(request.plan.url)})`,
    ...headersOf(request).map(
      ([name, value]) => `    .header(${quoteRust(name)}, ${quoteRust(value)})`,
    ),
  ];

  const text = textBodyOf(request);
  if (text !== null) lines.push(`    .body(${quoteRust(text)})`);

  lines.push('    .send()', '    .await?;');

  return { kind: 'source', source: lines.join('\n') };
}
