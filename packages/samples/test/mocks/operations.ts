/**
 * Operations the sample tests are written against, as `runnerOperationOf` would project them.
 *
 * Each takes the server url so that the wire level suite can point the same operation at a real
 * loopback server without a second copy of the fixture existing.
 */

import type {
  RequestInputs,
  RunnableOperation,
  RunnableParameter,
  RunnerFile,
} from '@openref/runner';

/** The server the unit suites use, which no test ever sends a request to. */
export const SERVER = 'https://api.example.com/v1';

/** A query parameter, with the defaults the normalizer fills in. */
export function queryParameter(
  name: string,
  overrides: Partial<RunnableParameter> = {},
): RunnableParameter {
  return { name, in: 'query', required: false, style: 'form', explode: true, ...overrides };
}

/** GET with two query parameters and no body. */
export function listPets(server: string = SERVER): RunnableOperation {
  return {
    nodeId: 'get-pets',
    method: 'get',
    path: '/pets',
    parameters: [queryParameter('limit'), queryParameter('tags', { explode: false })],
    servers: [server],
    security: [],
    body: [],
  };
}

/** POST with a JSON body and an apiKey header scheme. */
export function createPet(server: string = SERVER): RunnableOperation {
  return {
    nodeId: 'post-pets',
    method: 'post',
    path: '/pets',
    parameters: [],
    servers: [server],
    security: [{ id: 'apiKey', type: 'apiKey', in: 'header', name: 'X-Api-Key' }],
    body: [{ mediaType: 'application/json' }],
  };
}

/** POST with a plain text body, which the runner passes through without validating it. */
export function postNote(server: string = SERVER): RunnableOperation {
  return {
    nodeId: 'post-notes',
    method: 'post',
    path: '/notes',
    parameters: [],
    servers: [server],
    security: [],
    body: [{ mediaType: 'text/plain' }],
  };
}

/** POST with a path parameter and a multipart body. */
export function uploadPhoto(server: string = SERVER): RunnableOperation {
  return {
    nodeId: 'post-pets-photo',
    method: 'post',
    path: '/pets/{petId}/photo',
    parameters: [{ name: 'petId', in: 'path', required: true, style: 'simple', explode: false }],
    servers: [server],
    security: [],
    body: [{ mediaType: 'multipart/form-data' }],
  };
}

/** PUT with a binary body. */
export function replacePhoto(server: string = SERVER): RunnableOperation {
  return {
    nodeId: 'put-pets-photo',
    method: 'put',
    path: '/pets/{petId}/photo',
    parameters: [{ name: 'petId', in: 'path', required: true, style: 'simple', explode: false }],
    servers: [server],
    security: [],
    body: [{ mediaType: 'image/png' }],
  };
}

/** A file part, small enough to compare byte for byte. */
export function pngFile(): RunnerFile {
  return {
    fileName: 'cover.png',
    mediaType: 'image/png',
    bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  };
}

/**
 * The operation the page cost figures in the `T059` amendment section are measured from.
 *
 * IT IS A FIXTURE BECAUSE THE FIGURES ARE A RECORD. A section that says nine samples weigh a
 * number, over an operation described only in prose, states something nobody can re-measure; the
 * next reader either trusts it or re-invents an operation of their own and gets a different
 * number. This is that operation, committed: a POST with a path parameter, an exploded query
 * array, a bearer scheme and a small JSON body, which is the shape most of a real reference is
 * made of.
 */
export function representativeOperation(server: string = SERVER): RunnableOperation {
  return {
    nodeId: 'post-orders',
    method: 'post',
    path: '/orders/{orderId}/items',
    parameters: [
      { name: 'orderId', in: 'path', required: true, style: 'simple', explode: false },
      queryParameter('expand'),
    ],
    servers: [server],
    security: [{ id: 'bearer', type: 'http', scheme: 'bearer' }],
    body: [{ mediaType: 'application/json' }],
  };
}

/** What a reader filled in for {@link representativeOperation}, fixed so the figures reproduce. */
export function representativeInputs(server: string = SERVER): RequestInputs {
  return {
    values: {
      'path:orderId': { kind: 'primitive', value: 'ord_1234567890' },
      'query:expand': { kind: 'array', value: ['items', 'customer'] },
    },
    serverUrl: server,
    body: {
      kind: 'text',
      text: JSON.stringify(
        {
          sku: 'SKU-1029',
          quantity: 3,
          note: 'gift wrap',
          price: { amount: 1299, currency: 'EUR' },
        },
        null,
        2,
      ),
    },
  };
}
