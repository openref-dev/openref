/**
 * The three command line tools SPEC 18 adds beside cURL: HTTPie, wget and PowerShell.
 *
 * EVERY LIMIT IN THIS FILE WAS TAKEN OFF A LIVE SERVER AND NOT OFF A MANUAL. Each tool was run
 * against a loopback server that records bytes on 2026-09-03, and what it could carry and what it
 * could not was read from the request that arrived. Three of the results contradicted what the
 * tools are usually said to do, which is the whole reason the rule is measurement: wget carries an
 * arbitrary method, an empty header value and a byte exact file body; HTTPie and PowerShell leave
 * a percent encoded query string alone; and PowerShell carries `Content-Type` inside `-Headers`,
 * which its 5.1 ancestor refused.
 *
 * WHERE A TOOL CANNOT SAY WHAT THE RUNNER SENDS, THE TAB SAYS SO. That is the rule SPEC 14.7
 * already applies to a socket handshake, where five causes exist because one sentence would point
 * somewhere false for four of them, and it is the rule `emit-curl.ts` already applies to a
 * multipart field name curl reads as the end of a name. A command that looks right and sends
 * something else is the one output SPEC 18 forbids by name, so the sample goes and the reason comes
 * back as data.
 */

import { quotePowerShell, quoteShell } from './literals';
import type { HeaderPair } from './plan-parts';
import {
  binaryFileOf,
  contentTypeHeaderOf,
  headersOf,
  multipartFieldsOf,
  shellUrl,
  textBodyOf,
} from './plan-parts';
import type { SampleRequest } from './sample-request';
import {
  HTTPIE_MULTIPART_REFUSAL,
  HTTPIE_SEPARATOR_REFUSAL,
  POWERSHELL_MULTIPART_REFUSAL,
  POWERSHELL_TYPED_EMPTY_REFUSAL,
  UNTYPED_BODY_REFUSAL,
  WGET_MULTIPART_REFUSAL,
  type EmitOutcome,
} from './languages';

/** How the arguments of one shell command are separated: a continuation and two spaces. */
const CONTINUE = ' \\\n  ';

/** How the parameters of one PowerShell command are separated: a backtick and two spaces. */
const POWERSHELL_CONTINUE = ' `\n  ';

/** The characters HTTPie reads as the separator of a request item rather than as part of a name. */
const HTTPIE_SEPARATORS = /[=@]/;

/** The characters that make a separator when this emitter joins a name to a value with a colon. */
const HTTPIE_VALUE_OPENERS = /^[=@]/;

/**
 * Why no command line tool can be handed this request, or null when one can.
 *
 * A BODY WITH NO STATED CONTENT TYPE IS THE ONE SHARED REFUSAL, and it is here rather than in each
 * emitter because all three tools fail it the same way: each substitutes a content type of its own.
 * `sample-request.ts` records that this does not arise today, and a guard on what cannot arise
 * today is the difference between that claim and a claim that it can never arise.
 *
 * @param request - The request being emitted
 * @returns The reason, or null
 */
function untypedBody(request: SampleRequest): string | null {
  const hasBody = request.plan.body !== null;

  return hasBody && request.contentType === null ? UNTYPED_BODY_REFUSAL : null;
}

/**
 * Emits the HTTPie sample.
 *
 * THE EMPTY VALUED HEADER TAKES THE OTHER SPELLING, AND GETTING THIS WRONG IS SILENT. Measured:
 * `X-Empty:` removes the header from the request HTTPie sends, and `X-Empty;` sends it with an
 * empty value, so the obvious `name:value` form drops exactly the header the runner does send.
 *
 * `--ignore-stdin` IS PART OF THE SAMPLE AND NOT DECORATION. HTTPie reads standard input as the
 * body whenever it is not a terminal, so a reader who pipes the command, or runs it from a script,
 * would send whatever was on the pipe. The binary case is the one place standard input is wanted,
 * and there the flag is left out and the file is redirected in.
 *
 * @param request - The request the runner would send
 * @returns The command, or the refusal
 */
export function emitHttpie(request: SampleRequest): EmitOutcome {
  const untyped = untypedBody(request);
  if (untyped !== null) return { kind: 'refused', reason: untyped };

  if (multipartFieldsOf(request) !== null) {
    return { kind: 'refused', reason: HTTPIE_MULTIPART_REFUSAL };
  }

  // THE NAME AND THE VALUE BOTH, BECAUSE THE JOIN IS WHAT MAKES THE SEPARATOR. This emitter writes
  // `name:value`, so a value opening with `=` turns the colon into HTTPie's `:=` raw JSON separator
  // and a value opening with `@` turns the item into "read this header from a file". Both were
  // measured sending a different request at exit 0. A separator later in the value is text:
  // `a@b.com` was measured arriving intact, so only the first character counts.
  const headers = headersOf(request);
  const misread = headers.some(
    ([name, value]) => HTTPIE_SEPARATORS.test(name) || HTTPIE_VALUE_OPENERS.test(value),
  );
  if (misread) {
    return { kind: 'refused', reason: HTTPIE_SEPARATOR_REFUSAL };
  }

  const file = binaryFileOf(request);
  const text = textBodyOf(request);

  const parts = [
    `http${file === null ? ' --ignore-stdin' : ''} ${request.plan.method} ` +
      shellUrl(request.plan.url),
    ...headers.map(([name, value]) => quoteShell(value === '' ? `${name};` : `${name}:${value}`)),
  ];

  if (text !== null) parts.push(`--raw ${quoteShell(text)}`);

  const command = parts.join(CONTINUE);

  return {
    kind: 'source',
    source: file === null ? command : `${command}${CONTINUE}< ${quoteShell(file.fileName)}`,
  };
}

/**
 * Emits the wget sample.
 *
 * WGET CARRIES MORE THAN ITS REPUTATION AND EXACTLY ONE THING LESS. Measured on 1.25.0: `--method`
 * takes a method the tool has never heard of, `--header` takes an empty value, `--body-file` sends
 * a file byte for byte, and the request target arrives percent for percent. What it has is no form
 * encoder at all, so a multipart body is the one shape it cannot frame.
 *
 * `-O -` IS IN THE SAMPLE BECAUSE THE DEFAULT IS A FILE. wget writes the response body to a file
 * named after the request target unless told otherwise, so a reader copying a bare command gets a
 * file in their working directory instead of the response they were looking at.
 *
 * @param request - The request the runner would send
 * @returns The command, or the refusal
 */
export function emitWget(request: SampleRequest): EmitOutcome {
  const untyped = untypedBody(request);
  if (untyped !== null) return { kind: 'refused', reason: untyped };

  if (multipartFieldsOf(request) !== null) {
    return { kind: 'refused', reason: WGET_MULTIPART_REFUSAL };
  }

  const file = binaryFileOf(request);
  const text = textBodyOf(request);

  const parts = [
    'wget -O -',
    `--method ${quoteShell(request.plan.method)}`,
    ...headersOf(request).map(
      ([name, value]: HeaderPair) => `--header ${quoteShell(`${name}: ${value}`)}`,
    ),
  ];

  if (file !== null) parts.push(`--body-file ${quoteShell(file.fileName)}`);
  else if (text !== null) parts.push(`--body-data ${quoteShell(text)}`);

  parts.push(shellUrl(request.plan.url));

  return { kind: 'source', source: parts.join(CONTINUE) };
}

/** The `-Headers` hash table, or nothing at all when the request carries no headers. */
function powerShellHeaders(headers: readonly HeaderPair[]): readonly string[] {
  if (headers.length === 0) return [];

  const entries = headers
    .map(([name, value]) => `    ${quotePowerShell(name)} = ${quotePowerShell(value)}`)
    .join('\n');

  return [`-Headers @{\n${entries}\n  }`];
}

/**
 * Emits the PowerShell sample, over `Invoke-RestMethod`.
 *
 * `-CustomMethod` FOR EVERY METHOD, WHICH IS ONE SHAPE RATHER THAN TWO. `-Method` binds to the
 * `WebRequestMethod` enumeration and refuses anything outside it: measured, `-Method PROPFIND`
 * ended with a binding error and sent nothing, while `-CustomMethod PROPFIND` sent it. Since
 * `-CustomMethod` was measured to send `GET` and `POST` identically too, picking per method would
 * buy a second code path and a fallback nobody exercises, which is the reason the Python emitter
 * gives for its own single call shape.
 *
 * THE ONE REFUSAL THAT IS NOT ABOUT A FORM IS THE C# REFUSAL, MEASURED HERE. `Invoke-RestMethod`
 * given a content type and no body sent the request with no content type on it, because .NET
 * carries that header on the content and there was no content.
 *
 * @param request - The request the runner would send
 * @returns The command, or the refusal
 */
export function emitPowerShell(request: SampleRequest): EmitOutcome {
  const untyped = untypedBody(request);
  if (untyped !== null) return { kind: 'refused', reason: untyped };

  if (multipartFieldsOf(request) !== null) {
    return { kind: 'refused', reason: POWERSHELL_MULTIPART_REFUSAL };
  }

  const file = binaryFileOf(request);
  const text = textBodyOf(request);
  const headers = headersOf(request);

  // NARROWED TO THE ONE METHOD THE MATRIX FOUND IT ON. The first edition refused every bodyless
  // request that declared a content type; measured across GET, HEAD, POST, PUT, DELETE and OPTIONS,
  // only GET reached the server without the header, and refusing the other five dropped tabs that
  // send exactly what the console sends.
  if (
    request.plan.method === 'GET' &&
    file === null &&
    text === null &&
    contentTypeHeaderOf(request) !== null
  ) {
    return { kind: 'refused', reason: POWERSHELL_TYPED_EMPTY_REFUSAL };
  }

  const parts = [
    'Invoke-RestMethod',
    `-Uri ${quotePowerShell(request.plan.url)}`,
    `-CustomMethod ${quotePowerShell(request.plan.method)}`,
    ...powerShellHeaders(headers),
  ];

  if (file !== null) {
    parts.push(`-Body ([System.IO.File]::ReadAllBytes(${quotePowerShell(file.fileName)}))`);
  } else if (text !== null) {
    parts.push(`-Body ${quotePowerShell(text)}`);
  } else {
    // AN EMPTY `-ContentType` IS WHAT STOPS IT INVENTING ONE, and without it the request differs.
    // Measured on 2026-09-03, once the wire comparison stopped looking only at the headers the plan
    // names: a bodyless POST reached the server carrying
    // `Content-Type: application/x-www-form-urlencoded`, which the runner never sent. PUT, PATCH and
    // DELETE did not invent one, and `-ContentType ''` was measured harmless on GET and DELETE, so
    // it is written for every bodyless request rather than for the one method that needs it: a
    // per method exception here would be a rule nobody could read off the sample.
    parts.push(`-ContentType ${quotePowerShell('')}`);
  }

  return { kind: 'source', source: parts.join(POWERSHELL_CONTINUE) };
}
