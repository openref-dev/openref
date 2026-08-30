/**
 * What `T059` broke in the cURL emitter, and the shape each fix has to keep.
 *
 * TWO DIFFERENT INJECTIONS SHARE ONE SAMPLE AND ONLY ONE OF THEM WAS DEFENDED. `quoteShell` makes
 * every value arrive at curl as exactly one argument, and the first half of this file proves that
 * against a real `/bin/sh` rather than by reading the escaper: nine hostile spellings in four
 * positions, each landing as one element of argv, with nothing executed. The second half is the
 * injection that was open: inside a `-F` argument curl parses `name=content;type=…` itself, so the
 * three positions that were interpolated raw let a document decide what the copied command sends,
 * which SPEC 18 forbids by name.
 */

import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { buildSampleRequest, generateCodeSamples } from '../../src/index';
import { queryParameter, SERVER } from '../mocks/operations';
import type { RunnableOperation } from '@openref/runner';

/**
 * Spellings that end a word, open a command or substitute one in every shell family.
 *
 * Each one writes a file whose absence is the assertion, so a case that stopped quoting would leave
 * evidence on disk rather than merely a different string.
 */
const HOSTILE = [
  `'; touch /tmp/openref-attack-1; echo '`,
  '$(touch /tmp/openref-attack-2)',
  '`touch /tmp/openref-attack-3`',
  '"; touch /tmp/openref-attack-4; #',
  '\n touch /tmp/openref-attack-5 \n',
  "\\'; touch /tmp/openref-attack-6; #",
  '${IFS}touch${IFS}/tmp/openref-attack-7',
  '|touch /tmp/openref-attack-8',
  '&& touch /tmp/openref-attack-9',
];

function shellOf(request: ReturnType<typeof buildSampleRequest>): string {
  const sample = generateCodeSamples(request).samples.find((entry) => entry.lang === 'shell');

  return sample?.source ?? '';
}

/**
 * The emitted command as a real shell parses it, with curl replaced by a printer.
 *
 * THE SHELL IS THE ONE THAT DECIDES AND NOT A REGULAR EXPRESSION. What is under test is whether a
 * quoting rule holds, and the only thing that knows is the parser a reader pastes into.
 *
 * @param source - The emitted command
 * @returns One line per argument curl would have received
 */
function argvOf(source: string): string[] {
  const printed = source.replace(/^curl/, 'printf "%s\\n"');

  return execFileSync('/bin/sh', ['-c', printed], { encoding: 'utf8' }).split('\n');
}

function queryOperation(name: string): RunnableOperation {
  return {
    nodeId: 'get-pets',
    method: 'get',
    path: '/pets',
    parameters: [queryParameter(name)],
    servers: [SERVER],
    security: [],
    body: [],
  };
}

function multipartOperation(): RunnableOperation {
  return {
    nodeId: 'post-pets-photo',
    method: 'post',
    path: '/pets',
    parameters: [],
    servers: [SERVER],
    security: [],
    body: [{ mediaType: 'multipart/form-data' }],
  };
}

describe('the cURL sample against a hostile document, per SPEC 18 and T059', () => {
  it('should keep a hostile query value inside one argument of a real shell', () => {
    // Given the nine spellings, each in a query value
    for (const value of HOSTILE) {
      const request = buildSampleRequest(queryOperation('q'), {
        serverUrl: SERVER,
        values: { 'query:q': { kind: 'primitive', value } },
      });

      // When the emitted command is parsed by /bin/sh
      const argv = argvOf(shellOf(request));

      // Then the whole url is one argument, so nothing in the value was read as syntax. The
      // presence half: the value really did reach the command, percent encoded by the runner.
      expect(argv.filter((entry) => entry !== '')).toHaveLength(3);
      expect(argv[2]).toContain('https://api.example.com/v1/pets?q=');
    }
  });

  it('should keep a hostile header value inside one argument of a real shell', () => {
    // Given
    const operation: RunnableOperation = {
      nodeId: 'get-pets',
      method: 'get',
      path: '/pets',
      parameters: [
        { name: 'X-Evil', in: 'header', required: false, style: 'simple', explode: false },
      ],
      servers: [SERVER],
      security: [],
      body: [],
    };

    for (const value of HOSTILE) {
      // When
      const argv = argvOf(
        shellOf(
          buildSampleRequest(operation, {
            serverUrl: SERVER,
            values: { 'header:X-Evil': { kind: 'primitive', value } },
          }),
        ),
      );

      // Then the header travels whole, line breaks and all, and no word of it became a command
      expect(argv).toContain('-H');
      expect(argv.join('\n')).toContain(`X-Evil: ${value}`);
    }
  });

  it('should keep a hostile text body inside one argument of a real shell', () => {
    // Given
    const operation: RunnableOperation = {
      nodeId: 'post-notes',
      method: 'post',
      path: '/notes',
      parameters: [],
      servers: [SERVER],
      security: [],
      body: [{ mediaType: 'text/plain' }],
    };

    for (const value of HOSTILE) {
      // When
      const argv = argvOf(
        shellOf(
          buildSampleRequest(operation, {
            serverUrl: SERVER,
            values: {},
            body: { kind: 'text', text: value },
          }),
        ),
      );

      // Then
      expect(argv).toContain('--data-raw');
      expect(argv.join('\n')).toContain(value);
    }
  });

  it('should have executed none of the nine, which is what the three cases above are for', () => {
    // Given the three cases above have run, each printing rather than sending
    // When the marks each hostile spelling would have left are looked for
    const written = HOSTILE.map((_, index) => `/tmp/openref-attack-${String(index + 1)}`).filter(
      (path) => {
        try {
          execFileSync('/bin/sh', ['-c', `test -e ${path}`]);

          return true;
        } catch {
          return false;
        }
      },
    );

    // Then
    expect(written).toEqual([]);
  });

  it('should refuse the whole sample when a multipart field name carries the character curl reads as the end of a name', () => {
    // Given a document whose multipart schema names a property `a=b`, which is legal in a schema
    const request = buildSampleRequest(multipartOperation(), {
      serverUrl: SERVER,
      values: {},
      mediaType: 'multipart/form-data',
      body: { kind: 'fields', fields: [{ kind: 'text', name: 'a=b', value: 'v' }] },
    });

    // When
    const generated = generateCodeSamples(request);

    // Then the cURL sample is gone with a reason rather than present and wrong: curl would have
    // sent a field named `a` with the content `b=v`
    expect(generated.samples.some((sample) => sample.lang === 'shell')).toBe(false);
    expect(generated.omitted.find((entry) => entry.lang === 'shell')?.reason).toContain(
      'the end of the field name',
    );
  });

  it('should refuse the whole sample when a part content type carries a quotation mark curl passes through literally', () => {
    // Given
    const request = buildSampleRequest(multipartOperation(), {
      serverUrl: SERVER,
      values: {},
      mediaType: 'multipart/form-data',
      body: {
        kind: 'fields',
        fields: [{ kind: 'text', name: 'a', value: 'v', contentType: 'text/plain";x="y' }],
      },
    });

    // When
    const generated = generateCodeSamples(request);

    // Then
    expect(generated.samples.some((sample) => sample.lang === 'shell')).toBe(false);
    expect(generated.omitted.find((entry) => entry.lang === 'shell')?.reason).toContain('type=');
  });

  it('should escape a quotation mark in a part value and in a file name, which curl does read as quoting', () => {
    // Given the control for the two refusals above: the two positions curl parses quotes in
    const request = buildSampleRequest(multipartOperation(), {
      serverUrl: SERVER,
      values: {},
      mediaType: 'multipart/form-data',
      body: {
        kind: 'fields',
        fields: [
          { kind: 'text', name: 'a', value: 'x";type=text/html;y="', contentType: 'text/plain' },
          {
            kind: 'file',
            name: 'f',
            file: {
              fileName: 'real.png";type=text/html;x="',
              mediaType: 'image/png',
              bytes: new Uint8Array([1]),
            },
          },
        ],
      },
    });

    // When
    const source = shellOf(request);

    // Then both are quoted, so curl reads the semicolons as text rather than as parameters, and
    // the type each part declares is the one the runner would have sent
    expect(source).toContain('-F \'a="x\\";type=text/html;y=\\"";type=text/plain\'');
    expect(source).toContain('-F \'f=@"real.png\\";type=text/html;x=\\"";type=image/png\'');
  });
});
