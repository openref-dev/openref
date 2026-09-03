/**
 * The nine level 2 languages of SPEC 18: Go, PHP, Java, C#, Ruby, Rust, Swift, Kotlin and Dart.
 *
 * A TEMPLATE RENDERS A TEXT BODY AND REFUSES A BYTE ONE, and the refusal is the honest half of
 * this file. A multipart form and a binary upload reach the plan as bytes; writing nine multipart
 * encoders by hand would put nine untested body builders into the one place SPEC 18 exists to keep
 * a single answer, and a template that printed a comment where the body belongs would be code a
 * reader copies and watches fail. The refusal names the three tabs that do carry it.
 *
 * THE THREE MOBILE CLIENTS WERE ADDED FOR A READER AND NOT FOR SYMMETRY, per the SPEC 18 ruling of
 * 2026-09-03. A mobile application is a constant consumer of an HTTP API and none of the first six
 * covered one: Java is the JVM's server half and Android has been Kotlin for years, so Swift,
 * Kotlin and Dart cover iOS, Android and Flutter respectively. Each is spelled with the client its
 * own platform actually uses rather than with whatever was easiest to template.
 *
 * EACH TEMPLATE SETS THE CONTENT TYPE THE WAY ITS CLIENT DEMANDS RATHER THAN THE WAY THE OTHERS
 * DO. .NET refuses a content type on the request headers and takes it on the content, and its
 * `StringContent` convenience constructor appends a charset the runner never sent, so the sample
 * parses the runner's own value onto the content instead. That is the whole discipline of this
 * package in one line: the same bytes, spelled as each client spells them.
 */

import {
  quoteDart,
  quoteKotlin,
  quotePhp,
  quoteRuby,
  quoteRust,
  quoteSwift,
  quoteUnicode,
} from './literals';
import type { HeaderPair } from './plan-parts';
import { contentTypeHeaderOf, hasByteBody, headersOf, textBodyOf } from './plan-parts';
import type { SampleRequest } from './sample-request';
import { BYTE_BODY_REFUSAL, OKHTTP_MISSING_BODY_REFUSAL, type EmitOutcome } from './languages';

/** The methods OkHttp requires a request body on, from its own `HttpMethod.requiresRequestBody`. */
const OKHTTP_BODY_REQUIRED_METHODS: readonly string[] = [
  'POST',
  'PUT',
  'PATCH',
  'PROPPATCH',
  'REPORT',
];

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

/** Every header except the content type, which three of these clients attach to the body. */
function headersExceptContentType(request: SampleRequest): readonly HeaderPair[] {
  return headersOf(request).filter(([name]) => name.toLowerCase() !== 'content-type');
}

/** The refusal every template shares, so the nine cannot word it nine ways. */
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
  const contentType = contentTypeHeaderOf(request);
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

  const text = textBodyOf(request);

  // A BODYLESS REQUEST TAKES THE GENERIC CLASS, AND THE REASON IS A HEADER RUBY INVENTS. Measured
  // on 2026-09-03 once the wire comparison stopped looking only at the headers the plan names:
  // `Net::HTTP::Post.new(uri)` with no body reaches the server carrying
  // `Content-Type: application/x-www-form-urlencoded`, which the runner never sent, because a
  // request class whose `REQUEST_HAS_BODY` is true is given an empty body and then a default content
  // type. `Net::HTTPGenericRequest.new(method, false, true, uri)` says the request has no body and
  // was measured sending neither invented field. The named class is kept wherever there is a body,
  // because that is the idiomatic form and it invents nothing.
  const named = text === null ? undefined : RUBY_REQUEST_CLASSES[request.plan.method];
  const construct =
    named === undefined
      ? `Net::HTTPGenericRequest.new(${quoteRuby(request.plan.method)}, ` +
        `${text === null ? 'false' : 'true'}, true, uri)`
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

/**
 * Emits the Swift sample, over `URLSession`.
 *
 * THE HEADERS GO ON THE REQUEST AND URLSession KEEPS THEM, which was measured rather than assumed.
 * Swift 6.2 on 2026-09-03 was given `Authorization`, an empty valued header and a bogus
 * `Content-Length` on one `URLRequest`; the first two arrived at the server unchanged and the third
 * was recomputed to the real length. The reserved header list people quote for `URLSession` is
 * about `URLSessionConfiguration.httpAdditionalHeaders`, not about `setValue(_:forHTTPHeaderField:)`,
 * and `Content-Length` is a header no client here lets a caller state, `fetch` included.
 *
 * @param request - The request the runner would send
 * @returns The snippet, or the refusal
 */
export function emitSwift(request: SampleRequest): EmitOutcome {
  const refused = refuseBytes(request);
  if (refused !== null) return refused;

  const text = textBodyOf(request);
  const lines = [
    'import Foundation',
    '',
    `var request = URLRequest(url: URL(string: ${quoteSwift(request.plan.url)})!)`,
    `request.httpMethod = ${quoteSwift(request.plan.method)}`,
    ...headersOf(request).map(
      ([name, value]) =>
        `request.setValue(${quoteSwift(value)}, forHTTPHeaderField: ${quoteSwift(name)})`,
    ),
  ];

  if (text !== null) lines.push(`request.httpBody = Data(${quoteSwift(text)}.utf8)`);

  lines.push('', 'let (data, response) = try await URLSession.shared.data(for: request)');

  return { kind: 'source', source: lines.join('\n') };
}

/**
 * Emits the Kotlin sample, over OkHttp.
 *
 * OkHttp AND NOT `java.net.http`, WHICH IS THE WHOLE POINT OF THE TAB. The Java template already
 * covers the JDK client, and the reader this language is here for is on Android, where
 * `java.net.http` does not exist. A Kotlin tab spelling the JDK client would be the Java tab with
 * different punctuation and would not run on the platform it was added for.
 *
 * THE CONTENT TYPE TRAVELS ON THE BODY, as it does in the C# template and for the same class of
 * reason: OkHttp's bridge interceptor writes `Content-Type` from `RequestBody.contentType()`, so a
 * sample that also set the header would state one value in two places. A body whose content type
 * the plan does not carry gets `toRequestBody()` with no media type, which is a body with no content
 * type, which is what the runner sent.
 *
 * @param request - The request the runner would send
 * @returns The snippet, or the refusal
 */
export function emitKotlin(request: SampleRequest): EmitOutcome {
  const refused = refuseBytes(request);
  if (refused !== null) return refused;

  const text = textBodyOf(request);

  // THE HALF OF `Request.Builder.method` THAT IS STILL THIS EMITTER'S TO GUARD. It rejects a body
  // on a method that permits none and a missing body on a method that requires one; the first
  // guards `GET` and `HEAD`, which the runner itself refuses to send, so that request never reaches
  // here. What is left is the commoner shape by far: a bodyless POST is an everyday operation, and
  // `.method("POST", null)` throws before a connection opens.
  if (text === null && OKHTTP_BODY_REQUIRED_METHODS.includes(request.plan.method)) {
    return { kind: 'refused', reason: OKHTTP_MISSING_BODY_REFUSAL };
  }

  const contentType = contentTypeHeaderOf(request);
  const headers = text === null ? headersOf(request) : headersExceptContentType(request);

  const imports = [
    ...(text === null || contentType === null
      ? []
      : ['import okhttp3.MediaType.Companion.toMediaType']),
    'import okhttp3.OkHttpClient',
    'import okhttp3.Request',
    ...(text === null ? [] : ['import okhttp3.RequestBody.Companion.toRequestBody']),
    '',
  ];

  const media = contentType === null ? '' : `${quoteKotlin(contentType[1])}.toMediaType()`;
  const body = text === null ? 'null' : `${quoteKotlin(text)}.toRequestBody(${media})`;

  const lines = [
    'val request = Request.Builder()',
    `    .url(${quoteKotlin(request.plan.url)})`,
    ...headers.map(([name, value]) => `    .header(${quoteKotlin(name)}, ${quoteKotlin(value)})`),
    `    .method(${quoteKotlin(request.plan.method)}, ${body})`,
    '    .build()',
    '',
    'val response = OkHttpClient().newCall(request).execute()',
  ];

  return { kind: 'source', source: [...imports, ...lines].join('\n') };
}

/**
 * Emits the Dart sample, over `package:http`.
 *
 * `bodyBytes` AND NOT `body`, AND THE DIFFERENCE IS A HEADER THE RUNNER DID NOT SEND. The `body`
 * setter of `http.Request` encodes the string and then writes the encoding's name into the content
 * type, so a runner sending `application/json` would become a sample sending
 * `application/json; charset=utf-8`. `bodyBytes` takes the encoded bytes and leaves the header
 * alone, which is the same discipline the C# template states about `StringContent`.
 *
 * @param request - The request the runner would send
 * @returns The snippet, or the refusal
 */
export function emitDart(request: SampleRequest): EmitOutcome {
  const refused = refuseBytes(request);
  if (refused !== null) return refused;

  const text = textBodyOf(request);
  const imports = [
    ...(text === null ? [] : ['import "dart:convert";']),
    'import "package:http/http.dart" as http;',
    '',
  ];

  const lines = [
    `final request = http.Request(${quoteDart(request.plan.method)}, ` +
      `Uri.parse(${quoteDart(request.plan.url)}));`,
    ...headersOf(request).map(
      ([name, value]) => `request.headers[${quoteDart(name)}] = ${quoteDart(value)};`,
    ),
  ];

  if (text !== null) lines.push(`request.bodyBytes = utf8.encode(${quoteDart(text)});`);

  lines.push('', 'final response = await http.Client().send(request);');

  return { kind: 'source', source: [...imports, ...lines].join('\n') };
}
