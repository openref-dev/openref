/**
 * TypeScript `fetch`, the second level 1 language of SPEC 18.
 *
 * IT IS THE SHAPE `FetchHttpTransport` USES, deliberately. That adapter maps a plan onto `fetch`
 * with the same four members in the same order, so a reader comparing the sample against what the
 * console does is comparing two spellings of one call rather than two designs.
 *
 * `FormData` SETS ITS OWN BOUNDARY, so the content type is left out of a multipart sample for the
 * reason `headersWithoutContentType` gives.
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

/**
 * The `headers` member, or nothing at all when the request carries none.
 *
 * AN EMPTY LITERAL IS LEFT OUT RATHER THAN PRINTED, for the same reason the task states about a
 * body argument: a member a reader has to look at and then decide is empty is noise, and a reader
 * copying the sample gets the same request either way.
 */
function headerMember(headers: readonly HeaderPair[]): readonly string[] {
  if (headers.length === 0) return [];

  const entries = headers
    .map(([name, value]) => `    ${quoteUnicode(name)}: ${quoteUnicode(value)},`)
    .join('\n');

  return [`  headers: {\n${entries}\n  },`];
}

/** The `FormData` a multipart request is built from, one `append` per part. */
function formDataBlock(fields: readonly RunnerBodyField[]): string {
  const lines = fields.map((field) => {
    if (field.kind === 'file') {
      return (
        `body.append(${quoteUnicode(field.name)}, new Blob([await readFile(` +
        `${quoteUnicode(field.file.fileName)})], { type: ${quoteUnicode(field.file.mediaType)} })` +
        `, ${quoteUnicode(field.file.fileName)});`
      );
    }

    if (field.contentType === undefined) {
      return `body.append(${quoteUnicode(field.name)}, ${quoteUnicode(field.value)});`;
    }

    return (
      `body.append(${quoteUnicode(field.name)}, new Blob([${quoteUnicode(field.value)}], ` +
      `{ type: ${quoteUnicode(field.contentType)} }));`
    );
  });

  return ['const body = new FormData();', ...lines].join('\n');
}

/**
 * Emits the TypeScript sample.
 *
 * @param request - The request the runner would send
 * @returns The call
 */
export function emitFetch(request: SampleRequest): EmitOutcome {
  const fields = multipartFieldsOf(request);
  const file = binaryFileOf(request);
  const text = textBodyOf(request);

  const readsFile = file !== null || (fields ?? []).some((field) => field.kind === 'file');
  const headers = fields === null ? headersOf(request) : headersWithoutContentType(request);

  const preamble: string[] = [];
  if (readsFile) preamble.push(`import { readFile } from "node:fs/promises";`, '');
  if (fields !== null) preamble.push(formDataBlock(fields), '');

  const call = [
    `const response = await fetch(${quoteUnicode(request.plan.url)}, {`,
    `  method: ${quoteUnicode(request.plan.method)},`,
    ...headerMember(headers),
  ];

  if (fields !== null) call.push('  body,');
  else if (file !== null) call.push(`  body: await readFile(${quoteUnicode(file.fileName)}),`);
  else if (text !== null) call.push(`  body: ${quoteUnicode(text)},`);

  call.push('});');

  return { kind: 'source', source: [...preamble, ...call].join('\n') };
}
