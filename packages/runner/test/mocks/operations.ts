import type { RunnableOperation, RunnableParameter, RunnableSecurityScheme } from '../../src/index';

/**
 * Operations the runner tests send.
 *
 * Written as the projection rather than as IR, because that is what the runner sees. The
 * projection itself is derived by `runnerOperationOf` in `@openref/vue` and tested there,
 * against a document the real normalizer produced.
 */

/** A parameter with the defaults the normalizer resolves. */
export function parameter(overrides: Partial<RunnableParameter> = {}): RunnableParameter {
  return {
    name: 'id',
    in: 'path',
    required: true,
    style: 'simple',
    explode: false,
    ...overrides,
  };
}

/** An operation with one server and nothing else. */
export function operation(overrides: Partial<RunnableOperation> = {}): RunnableOperation {
  return {
    nodeId: 'get-orders-id',
    method: 'get',
    path: '/orders/{id}',
    parameters: [parameter()],
    servers: ['https://api.example.com'],
    security: [],
    body: [],
    ...overrides,
  };
}

/** The two schemes M0 carries, and one it does not. */
export const BEARER: RunnableSecurityScheme = { id: 'bearerAuth', type: 'http', scheme: 'bearer' };
export const API_KEY_HEADER: RunnableSecurityScheme = {
  id: 'apiKey',
  type: 'apiKey',
  in: 'header',
  name: 'X-Key',
};
export const API_KEY_QUERY: RunnableSecurityScheme = {
  id: 'apiKeyQuery',
  type: 'apiKey',
  in: 'query',
  name: 'access_token',
};
export const OAUTH: RunnableSecurityScheme = { id: 'oauth', type: 'oauth2' };
