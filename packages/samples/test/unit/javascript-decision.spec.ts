/**
 * Why SPEC 18 has no JavaScript tab, checked rather than asserted.
 *
 * THE QUESTION WAS PUT AS A MEASUREMENT AND IS ANSWERED AS ONE. A JavaScript tab beside the
 * TypeScript one is worth a reader's attention only if the two differ; if the TypeScript emitter
 * writes no type annotation, then the JavaScript sample is the same bytes and the tab is a second
 * copy of its neighbour. So the emitter's own output is handed to a JavaScript parser, and the
 * absence of TypeScript syntax is proved by the source parsing as a JavaScript module rather than
 * by a search for a colon.
 *
 * A PROOF OF ABSENCE ASSERTS THE SUBJECT WAS PRESENT FIRST. Each case checks that the sample it is
 * about was actually produced and is not empty, because a parser handed nothing parses it happily.
 * The negative control checks the same parser rejects a source that does carry an annotation, so a
 * case that would pass whatever it was given is not what is holding this decision up.
 *
 * IT RUNS THE REAL PARSER IN A REAL PROCESS. `node --check --input-type=module` is the parser that
 * decides what JavaScript is on this runtime; a regular expression over the source would be this
 * package agreeing with itself about a language it did not implement.
 */

import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { buildSampleRequest, generateCodeSamples } from '../../src/index';
import type { SampleRequest } from '../../src/index';
import {
  createPet,
  listPets,
  pngFile,
  replacePhoto,
  representativeInputs,
  representativeOperation,
  SERVER,
  uploadPhoto,
} from '../mocks/operations';

/** Whether Node parses one source as an ECMAScript module. */
function parsesAsJavaScript(source: string): { ok: boolean; stderr: string } {
  const run = spawnSync(process.execPath, ['--check', '--input-type=module', '-'], {
    input: `${source}\n`,
    encoding: 'utf8',
  });

  return { ok: run.status === 0, stderr: run.stderr };
}

/** The TypeScript sample of one request. */
function typescriptOf(request: SampleRequest): string {
  const sample = generateCodeSamples(request).samples.find((entry) => entry.lang === 'typescript');
  expect(sample, 'the TypeScript emitter produced nothing to measure').toBeDefined();

  return sample?.source ?? '';
}

/** Every body shape the TypeScript emitter can write, so the answer covers all of them. */
function everyShape(): ReadonlyMap<string, string> {
  return new Map([
    [
      'no body',
      typescriptOf(
        buildSampleRequest(listPets(), {
          values: { 'query:limit': { kind: 'primitive', value: '10' } },
          serverUrl: SERVER,
        }),
      ),
    ],
    [
      'a text body',
      typescriptOf(
        buildSampleRequest(
          createPet(),
          { values: {}, serverUrl: SERVER, body: { kind: 'text', text: '{"a":1}' } },
          { apiKey: '<apiKey>' },
        ),
      ),
    ],
    [
      'a multipart body',
      typescriptOf(
        buildSampleRequest(uploadPhoto(), {
          values: { 'path:petId': { kind: 'primitive', value: '7' } },
          serverUrl: SERVER,
          body: {
            kind: 'fields',
            fields: [
              { kind: 'text', name: 'note', value: 'front' },
              { kind: 'file', name: 'cover', file: pngFile() },
            ],
          },
        }),
      ),
    ],
    [
      'a binary body',
      typescriptOf(
        buildSampleRequest(replacePhoto(), {
          values: { 'path:petId': { kind: 'primitive', value: '7' } },
          serverUrl: SERVER,
          body: { kind: 'binary', file: pngFile() },
        }),
      ),
    ],
    [
      'the representative operation',
      typescriptOf(
        buildSampleRequest(representativeOperation(), representativeInputs(), {
          bearer: '<bearer>',
        }),
      ),
    ],
  ]);
}

describe('the JavaScript tab SPEC 18 decided against', () => {
  it('should find the parser rejects TypeScript, so parsing proves something', () => {
    // Given, the negative control: a source that does carry an annotation
    const annotated = 'const response: Response = await fetch("https://example.com");';

    // When
    const verdict = parsesAsJavaScript(annotated);

    // Then
    expect(verdict.ok).toBe(false);
  });

  it('should parse every TypeScript sample as JavaScript, on every body shape', () => {
    // Given
    const shapes = everyShape();
    expect(shapes.size).toBe(5);

    for (const [name, source] of shapes) {
      // Given, the subject is present before its emptiness is claimed
      expect(source.length, `${name} produced an empty sample`).toBeGreaterThan(0);
      expect(source).toContain('await fetch(');

      // When
      const verdict = parsesAsJavaScript(source);

      // Then
      expect(verdict.ok, `${name} did not parse as JavaScript: ${verdict.stderr}`).toBe(true);
    }
  });

  it('should leave a JavaScript emitter nothing to remove, so the diff would be zero bytes', () => {
    // Given, what a JavaScript emitter would do to this source is strip the type syntax, and there
    // is none: the emitter writes no annotation, no generic argument, no assertion and no
    // declaration keyword TypeScript owns.
    const owned = [': Response', ' as ', 'interface ', '<Response>', '!.', 'readonly '];

    for (const [name, source] of everyShape()) {
      expect(source.length, `${name} produced an empty sample`).toBeGreaterThan(0);

      // Then
      for (const token of owned) {
        expect(source, `${name} carries ${token}`).not.toContain(token);
      }
    }
  });
});
