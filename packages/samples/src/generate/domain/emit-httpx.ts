/**
 * Python `httpx`, the third level 1 language of SPEC 18.
 *
 * `httpx.request(method, url, ...)` RATHER THAN `httpx.post(...)`, because the plan's method is a
 * string and OpenAPI 3.2 lets a document declare a method httpx has no helper for. A generator
 * that picked a helper per method would need a fallback nobody tests; the generic call has one
 * shape for all of them.
 *
 * MULTIPART GOES THROUGH `files` EVEN FOR THE TEXT PARTS. httpx's `data` cannot give a part its
 * own content type, and a text part that declares one is a part the runner sends with it, so the
 * uniform form is the one that can say everything the runner can send.
 */

import type { RunnerBodyField } from '@openref/runner';
import { quoteUnicode } from './literals';
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

/** The `headers` argument, or nothing at all when the request carries no headers. */
function headerArgument(headers: readonly HeaderPair[]): readonly string[] {
  if (headers.length === 0) return [];

  const entries = headers
    .map(([name, value]) => `        ${quoteUnicode(name)}: ${quoteUnicode(value)},`)
    .join('\n');

  return [`    headers={\n${entries}\n    },`];
}

/** One tuple per multipart part, in the shape httpx reads. */
function filesLiteral(fields: readonly RunnerBodyField[]): string {
  const entries = fields.map((field) => {
    if (field.kind === 'file') {
      return (
        `        (${quoteUnicode(field.name)}, (${quoteUnicode(field.file.fileName)}, ` +
        `Path(${quoteUnicode(field.file.fileName)}).read_bytes(), ` +
        `${quoteUnicode(field.file.mediaType)})),`
      );
    }

    const tail = field.contentType === undefined ? '' : `, ${quoteUnicode(field.contentType)}`;

    return `        (${quoteUnicode(field.name)}, (None, ${quoteUnicode(field.value)}${tail})),`;
  });

  return `[\n${entries.join('\n')}\n    ]`;
}

/**
 * Emits the Python sample.
 *
 * @param request - The request the runner would send
 * @returns The call
 */
export function emitHttpx(request: SampleRequest): EmitOutcome {
  const fields = multipartFieldsOf(request);
  const file = binaryFileOf(request);
  const text = textBodyOf(request);

  const readsFile = file !== null || (fields ?? []).some((field) => field.kind === 'file');
  const headers = fields === null ? headersOf(request) : headersWithoutContentType(request);

  const imports = readsFile
    ? ['from pathlib import Path', '', 'import httpx', '']
    : ['import httpx', ''];

  const call = [
    'response = httpx.request(',
    `    ${quoteUnicode(request.plan.method)},`,
    `    ${quoteUnicode(request.plan.url)},`,
    ...headerArgument(headers),
  ];

  if (fields !== null) call.push(`    files=${filesLiteral(fields)},`);
  else if (file !== null)
    call.push(`    content=Path(${quoteUnicode(file.fileName)}).read_bytes(),`);
  else if (text !== null) call.push(`    content=${quoteUnicode(text)},`);

  call.push(')');

  return { kind: 'source', source: [...imports, ...call].join('\n') };
}
