/**
 * cURL, the first of the three level 1 languages of SPEC 18.
 *
 * TWO PLACES WHERE THIS SAMPLE DELIBERATELY DOES NOT COPY THE PLAN, both because copying it would
 * send something else. A multipart body's `Content-Type` carries the runner's boundary and curl
 * writes its own, so the header is left to curl; emitting the runner's would declare one boundary
 * over a body framed with another, which no server can parse. And a text form field goes through
 * `--form-string` rather than `-F`, because `-F` reads a value beginning with `@` or `<` as a file
 * name: a reader whose field holds an email address would upload a file instead of sending it.
 */

import { quoteShell } from './literals';
import type { HeaderPair } from './plan-parts';
import {
  binaryFileOf,
  headersOf,
  headersWithoutContentType,
  multipartFieldsOf,
  textBodyOf,
} from './plan-parts';
import type { SampleRequest } from './sample-request';
import type { EmitOutcome } from './languages';

/** How the arguments of one command are separated: a continuation and two spaces. */
const CONTINUE = ' \\\n  ';

/** One `-H` argument per header, in the order `headersOf` fixed. */
function headerArguments(headers: readonly HeaderPair[]): readonly string[] {
  return headers.map(([name, value]) => `-H ${quoteShell(`${name}: ${value}`)}`);
}

/**
 * One multipart text part.
 *
 * TWO OPTIONS, BECAUSE ONE OF THEM CANNOT SAY EVERYTHING THE RUNNER SENDS. `--form-string` takes
 * its value literally and is therefore the safe form, and it has no way to give the part a content
 * type of its own. A text part that declares one, which `RunnerBodyField` allows and the runner's
 * encoder writes as a part header, therefore has to go through `-F`, whose value is quoted so that
 * a semicolon inside it is not read as another parameter and a leading at sign is not read as a
 * file name.
 */
function textPart(name: string, value: string, contentType: string | undefined): string {
  if (contentType === undefined) return `--form-string ${quoteShell(`${name}=${value}`)}`;

  const quoted = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  return `-F ${quoteShell(`${name}="${quoted}";type=${contentType}`)}`;
}

/**
 * The arguments that carry the body, whichever of the three shapes it is.
 *
 * @param request - The request being emitted
 * @returns The body arguments, empty when the request carries no body
 */
function bodyArguments(request: SampleRequest): readonly string[] {
  const fields = multipartFieldsOf(request);
  if (fields !== null) {
    return fields.map((field) =>
      field.kind === 'text'
        ? textPart(field.name, field.value, field.contentType)
        : `-F ${quoteShell(`${field.name}=@"${field.file.fileName}";type=${field.file.mediaType}`)}`,
    );
  }

  const file = binaryFileOf(request);
  if (file !== null) return [`--data-binary ${quoteShell(`@${file.fileName}`)}`];

  const text = textBodyOf(request);
  if (text === null) return [];

  return [`--data-raw ${quoteShell(text)}`];
}

/**
 * Emits the cURL sample.
 *
 * @param request - The request the runner would send
 * @returns The command
 *
 * @example
 * emitCurl(request);
 * // curl -X GET 'https://api.example.com/pets?limit=10'
 */
export function emitCurl(request: SampleRequest): EmitOutcome {
  const setsOwnContentType = multipartFieldsOf(request) !== null;
  const headers = setsOwnContentType ? headersWithoutContentType(request) : headersOf(request);

  const parts = [
    `curl -X ${request.plan.method} ${quoteShell(request.plan.url)}`,
    ...headerArguments(headers),
    ...bodyArguments(request),
  ];

  return { kind: 'source', source: parts.join(CONTINUE) };
}
