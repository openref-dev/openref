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
import type { RunnerBodyField } from '@openref/runner';
import type { HeaderPair } from './plan-parts';
import {
  binaryFileOf,
  headersOf,
  headersWithoutContentType,
  multipartFieldsOf,
  shellUrl,
  textBodyOf,
} from './plan-parts';
import type { SampleRequest } from './sample-request';
import type { EmitOutcome } from './languages';

/** How the arguments of one command are separated: a continuation and two spaces. */
const CONTINUE = ' \\\n  ';

/**
 * One `-H` argument per header, in the order `headersOf` fixed.
 *
 * AN EMPTY VALUE TAKES THE OTHER SPELLING, AND THE OBVIOUS ONE DROPS THE HEADER. Measured against
 * the real binary on 2026-09-03: `-H 'X-Empty: '` reaches the server with no such field at all, and
 * a value of nothing but spaces does the same, while the runner sends the header with an empty
 * value. `-H 'X-Empty;'` is curl's own spelling for "send this field empty" and was measured
 * arriving as one. HTTPie was given this fix when it was added; curl is the default tab and had
 * carried the defect since T057, which is why a blind review found it here rather than in a new
 * language.
 */
function headerArguments(headers: readonly HeaderPair[]): readonly string[] {
  return headers.map(([name, value]) =>
    value.trim() === '' ? `-H ${quoteShell(`${name};`)}` : `-H ${quoteShell(`${name}: ${value}`)}`,
  );
}

/**
 * One value curl's own form parser reads as a quoted literal.
 *
 * THE SHELL QUOTING IS NOT THIS QUESTION AND ANSWERING ONE DOES NOT ANSWER THE OTHER, which is the
 * defect `T059` measured. `quoteShell` makes the argument arrive at curl as one word; inside that
 * word curl parses `name=content;type=…` itself, so a quote or a semicolon interpolated raw is read
 * as curl syntax rather than as text. Measured before the fix, against the real binary: a file named
 * `real.png";type=text/html;x="` emitted `-F 'f=@"real.png";type=text/html;x="";type=image/png'`, and
 * the part curl then sent declared `text/html`, not the `image/png` the runner would have sent.
 *
 * IT IS APPLIED TO THE TWO POSITIONS CURL READS QUOTES IN AND TO NO OTHERS, which was established
 * by running the binary rather than by reading its manual, and the first form of this fix quoted all
 * four and was wrong in two. curl takes a field name literally up to the first `=` and a `type=`
 * value literally to the end, so quoting either produces a part named `%22a%22` or a content type
 * with quotation marks in it. Those two positions cannot be escaped at all, so they are checked
 * instead, by {@link inexpressibleField}.
 *
 * @param text - Whatever the document or the reader supplied
 * @returns The text as a curl form literal, quotes included
 */
function quoteFormValue(text: string): string {
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Why curl cannot be told to send this part as the runner would, or null when it can.
 *
 * TWO POSITIONS AND THE MEASURED REASON FOR EACH, both taken from real curl output. A field name
 * containing `=` ends the name where curl finds the first one, so `a=b` becomes the field `a` with
 * the rest as content. A field name containing `"` is emitted by curl as `name="a%22b"` while the
 * runner's own encoder writes `name="a\"b"`, so the two disagree on the wire even though nothing
 * was mis-parsed. A content type containing `"` is passed through with the quotation marks in it.
 *
 * REFUSING IS THE ANSWER SPEC 18 ALREADY GIVES FOR WHAT A LANGUAGE CANNOT WRITE. A sample that
 * shows a command sending something other than the button beside it is the one thing that section
 * forbids by name, so the whole cURL sample goes rather than one silently wrong argument.
 *
 * @param field - One multipart field
 * @returns The reason, or null
 */
function inexpressibleField(field: RunnerBodyField): string | null {
  const contentType = field.kind === 'text' ? field.contentType : field.file.mediaType;

  if (field.name.includes('=')) {
    return `the multipart field named ${JSON.stringify(field.name)} carries "=", which curl reads as the end of the field name, so the command would send a different field`;
  }
  if (/["\r\n]/.test(field.name)) {
    return `the multipart field named ${JSON.stringify(field.name)} carries a quotation mark or a line break, which curl and this runner write into the part header differently, so the command would not send what the button sends`;
  }
  if (contentType?.includes('"') === true) {
    return `the multipart field ${JSON.stringify(field.name)} declares the content type ${JSON.stringify(contentType)}, and curl passes a "type=" value through literally, so the quotation mark would reach the part header`;
  }

  return null;
}

/** What the body of one command turned into: its arguments, or the reason there are none. */
type BodyArguments =
  | { readonly kind: 'arguments'; readonly args: readonly string[] }
  | { readonly kind: 'refused'; readonly reason: string };

/**
 * Wraps a finished argument list.
 *
 * @param args - The arguments
 * @returns The list as the union member that carries one
 */
function arguments_(args: readonly string[]): BodyArguments {
  return { kind: 'arguments', args };
}

/**
 * One multipart text part.
 *
 * TWO OPTIONS, BECAUSE ONE OF THEM CANNOT SAY EVERYTHING THE RUNNER SENDS. `--form-string` takes
 * its value literally and is therefore the safe form, and it has no way to give the part a content
 * type of its own. A text part that declares one, which `RunnerBodyField` allows and the runner's
 * encoder writes as a part header, therefore has to go through `-F`, whose content is quoted so
 * that a semicolon inside it is not read as another parameter and a leading at sign is not read as
 * a file name.
 */
function textPart(name: string, value: string, contentType: string | undefined): string {
  if (contentType === undefined) return `--form-string ${quoteShell(`${name}=${value}`)}`;

  return `-F ${quoteShell(`${name}=${quoteFormValue(value)};type=${contentType}`)}`;
}

/**
 * The arguments that carry the body, whichever of the three shapes it is.
 *
 * @param request - The request being emitted
 * @returns The body arguments, or the reason no command can carry this body
 */
function bodyArguments(request: SampleRequest): BodyArguments {
  const fields = multipartFieldsOf(request);
  if (fields !== null) {
    for (const field of fields) {
      const reason = inexpressibleField(field);
      if (reason !== null) return { kind: 'refused', reason };
    }

    return arguments_(
      fields.map((field) =>
        field.kind === 'text'
          ? textPart(field.name, field.value, field.contentType)
          : `-F ${quoteShell(
              `${field.name}=@${quoteFormValue(field.file.fileName)};type=${field.file.mediaType}`,
            )}`,
      ),
    );
  }

  const file = binaryFileOf(request);
  if (file !== null) return arguments_([`--data-binary ${quoteShell(`@${file.fileName}`)}`]);

  const text = textBodyOf(request);
  if (text === null) return arguments_([]);

  return arguments_([`--data-raw ${quoteShell(text)}`]);
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
  const body = bodyArguments(request);

  if (body.kind === 'refused') return { kind: 'refused', reason: body.reason };

  const parts = [
    `curl -X ${request.plan.method} ${shellUrl(request.plan.url)}`,
    ...headerArguments(headers),
    ...body.args,
  ];

  return { kind: 'source', source: parts.join(CONTINUE) };
}
