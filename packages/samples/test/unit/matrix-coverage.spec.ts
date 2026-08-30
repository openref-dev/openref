import { describe, expect, it } from 'vitest';
import { SerializationError } from '@openref/core';
import type { IRParameterLocation, IRParameterStyle } from '@openref/core';
import type { RunnableOperation, RunnableSecurityScheme, RunnerValue } from '@openref/runner';
import { buildSampleRequest, generateCodeSamples, SAMPLE_LANGUAGES } from '../../src/index';
import type { SampleRequest } from '../../src/index';
import { pngFile, SERVER } from '../mocks/operations';

/**
 * The whole `style x explode x location x value kind` space of SPEC 14.2, enumerated rather than
 * copied.
 *
 * WHY THE TABLE ITSELF IS NOT RESTATED HERE. The runner owns which cells are defined, and a second
 * copy of that answer in this package would be exactly the drift SPEC 18 exists to prevent, one
 * level up. So every combination is offered to the runner, the ones it refuses are counted, and
 * the ones it renders are checked to reach the sample unchanged. The two counts are pinned, so a
 * cell that stops being defined, or starts, fails here.
 */
const STYLES: readonly IRParameterStyle[] = [
  'form',
  'simple',
  'label',
  'matrix',
  'spaceDelimited',
  'pipeDelimited',
  'deepObject',
];

const LOCATIONS: readonly IRParameterLocation[] = ['query', 'header', 'path', 'cookie'];

const VALUES: readonly RunnerValue[] = [
  { kind: 'primitive', value: 'blue' },
  { kind: 'array', value: ['blue', 'black'] },
  { kind: 'object', value: [['R', '100'] as const, ['G', '200'] as const] },
];

/** The cURL sample of one request, which is the tab this suite reads. */
function curlOf(request: SampleRequest): string {
  const { samples } = generateCodeSamples(
    request,
    SAMPLE_LANGUAGES.filter((language) => language.id === 'shell'),
  );

  return samples[0]?.source ?? '';
}

/** An operation carrying exactly one parameter in one cell of the matrix. */
function oneParameterOperation(
  style: IRParameterStyle,
  location: IRParameterLocation,
  explode: boolean,
): RunnableOperation {
  return {
    nodeId: 'cell',
    method: 'get',
    path: location === 'path' ? '/cells/{p}' : '/cells',
    parameters: [{ name: 'p', in: location, required: false, style, explode }],
    servers: [SERVER],
    security: [],
    body: [],
  };
}

describe('parameter serialization reaches the sample', () => {
  it('should carry every cell the runner defines and refuse the same ones it refuses', () => {
    // Given
    let rendered = 0;
    let refused = 0;
    let cookieRefused = 0;

    // When
    for (const style of STYLES) {
      for (const location of LOCATIONS) {
        for (const explode of [true, false]) {
          for (const value of VALUES) {
            const operation = oneParameterOperation(style, location, explode);
            let request: SampleRequest;
            try {
              request = buildSampleRequest(operation, {
                values: { [`${location}:p`]: value },
                serverUrl: SERVER,
              });
            } catch (error) {
              expect(error).toBeInstanceOf(SerializationError);
              refused += 1;
              if ((error as SerializationError).message.includes('cookie parameter')) {
                cookieRefused += 1;
              }
              continue;
            }

            rendered += 1;
            const source = curlOf(request);
            expect(source).toContain(`'${request.plan.url}'`);
            for (const [name, headerValue] of Object.entries(request.plan.headers)) {
              expect(source).toContain(`-H '${name}: ${headerValue}'`);
            }
          }
        }
      }
    }

    // Then, 7 styles x 4 locations x 2 explodes x 3 value kinds. The 35 are `form` at a query
    // (6), `simple` at a path and a header (12), `label` and `matrix` at a path (6 each),
    // `spaceDelimited` and `pipeDelimited` unexploded over an array and an object (2 each) and
    // `deepObject` exploded over an object (1). Of the 133 refusals, 42 are every style at a
    // cookie, because the runner refuses the location before it consults the table; six of those
    // 42 are cells the table does define, and a browser will not send them, so no sample shows
    // one either.
    expect(rendered + refused).toBe(168);
    expect(rendered).toBe(35);
    expect(refused).toBe(133);
    expect(cookieRefused).toBe(42);
  });

  it('should put a header parameter in the sample as a header and not in the url', () => {
    // Given
    const request = buildSampleRequest(oneParameterOperation('simple', 'header', false), {
      values: { 'header:p': { kind: 'array', value: ['blue', 'black'] } },
      serverUrl: SERVER,
    });

    // When
    const source = curlOf(request);

    // Then
    expect(request.plan.headers).toEqual({ p: 'blue,black' });
    expect(source).toContain(`-H 'p: blue,black'`);
    expect(request.plan.url).toBe(`${SERVER}/cells`);
  });
});

describe('every auth scheme the runner can send reaches the sample', () => {
  const cases: readonly {
    readonly name: string;
    readonly scheme: RunnableSecurityScheme;
    readonly credential: string;
    readonly expected: string;
  }[] = [
    {
      name: 'apiKey in a header',
      scheme: { id: 's', type: 'apiKey', in: 'header', name: 'X-Api-Key' },
      credential: 'k',
      expected: `-H 'X-Api-Key: k'`,
    },
    {
      name: 'apiKey in a query parameter',
      scheme: { id: 's', type: 'apiKey', in: 'query', name: 'api key' },
      credential: 'k/1',
      expected: `?api%20key=k%2F1'`,
    },
    {
      name: 'http basic',
      scheme: { id: 's', type: 'http', scheme: 'basic' },
      credential: 'ann:secret',
      expected: `-H 'Authorization: Basic YW5uOnNlY3JldA=='`,
    },
    {
      name: 'http bearer',
      scheme: { id: 's', type: 'http', scheme: 'bearer' },
      credential: 't',
      expected: `-H 'Authorization: Bearer t'`,
    },
    {
      name: 'oauth2',
      scheme: { id: 's', type: 'oauth2' },
      credential: 't',
      expected: `-H 'Authorization: Bearer t'`,
    },
    {
      name: 'openIdConnect',
      scheme: { id: 's', type: 'openIdConnect', openIdConnectUrl: 'https://id/.well-known' },
      credential: 't',
      expected: `-H 'Authorization: Bearer t'`,
    },
  ];

  for (const { name, scheme, credential, expected } of cases) {
    it(`should carry ${name} exactly where the runner puts it`, () => {
      // Given
      const operation: RunnableOperation = {
        nodeId: 'guarded',
        method: 'get',
        path: '/guarded',
        parameters: [],
        servers: [SERVER],
        security: [scheme],
        body: [],
      };

      // When
      const request = buildSampleRequest(
        operation,
        { values: {}, serverUrl: SERVER },
        {
          s: credential,
        },
      );
      const source = curlOf(request);

      // Then
      expect(source).toContain(expected);
    });
  }
});

describe('every body type the runner can send reaches the sample', () => {
  /** An operation declaring one media type. */
  function bodyOperation(mediaType: string): RunnableOperation {
    return {
      nodeId: 'body',
      method: 'post',
      path: '/things',
      parameters: [],
      servers: [SERVER],
      security: [],
      body: [{ mediaType }],
    };
  }

  it('should carry a JSON body as the exact text the runner sends', () => {
    // Given, When
    const request = buildSampleRequest(bodyOperation('application/json'), {
      values: {},
      serverUrl: SERVER,
      body: { kind: 'text', text: '{"a":1}' },
    });

    // Then
    expect(curlOf(request)).toContain(`--data-raw '{"a":1}'`);
  });

  it('should carry a form urlencoded body as the encoder produced it', () => {
    // Given, When
    const request = buildSampleRequest(bodyOperation('application/x-www-form-urlencoded'), {
      values: {},
      serverUrl: SERVER,
      body: {
        kind: 'fields',
        fields: [
          { kind: 'text', name: 'a', value: 'one two' },
          { kind: 'text', name: 'b', value: '&' },
        ],
      },
    });

    // Then
    expect(request.plan.body).toBe('a=one+two&b=%26');
    expect(curlOf(request)).toContain(`--data-raw 'a=one+two&b=%26'`);
  });

  it('should carry an ndjson body line for line', () => {
    // Given, When
    const request = buildSampleRequest(bodyOperation('application/x-ndjson'), {
      values: {},
      serverUrl: SERVER,
      body: { kind: 'text', text: '{"a":1}\n{"a":2}' },
    });

    // Then
    expect(curlOf(request)).toContain(`--data-raw '{"a":1}\n{"a":2}'`);
  });

  it('should carry a multipart body as parts, since the plan holds it as bytes', () => {
    // Given
    const request = buildSampleRequest(bodyOperation('multipart/form-data'), {
      values: {},
      serverUrl: SERVER,
      body: {
        kind: 'fields',
        fields: [
          { kind: 'text', name: 'a', value: 'one' },
          { kind: 'file', name: 'f', file: pngFile() },
        ],
      },
    });
    expect(typeof request.plan.body).not.toBe('string');

    // When
    const source = curlOf(request);

    // Then
    expect(source).toContain(`--form-string 'a=one'`);
    expect(source).toContain(`-F 'f=@"cover.png";type=image/png'`);
  });

  it('should carry a binary body as the file the reader chose', () => {
    // Given, When
    const request = buildSampleRequest(bodyOperation('image/png'), {
      values: {},
      serverUrl: SERVER,
      body: { kind: 'binary', file: pngFile() },
    });

    // Then
    expect(curlOf(request)).toContain(`--data-binary '@cover.png'`);
  });
});
