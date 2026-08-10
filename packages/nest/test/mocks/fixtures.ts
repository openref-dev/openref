/**
 * Fixtures shared by the unit suite.
 *
 * Nothing here reads the file system or builds anything. The point of the unit tests is that
 * the route table, the catalog and the service can be exercised without a NestJS application,
 * a theme package or a build, and a fixture that needed one of those would take that away.
 */

import type { AssetPlan } from '../../src/assets/infrastructure/adapters/package-assets.adapter';
import type { HttpAdapterLike } from '../../src/shared/types/nest-surface';

/** A tiny OpenAPI document with one tagged operation and one named schema. */
export function specification(): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: { title: 'Orders', version: '1.0.0', description: 'A very small API.' },
    servers: [{ url: 'https://api.example.test' }],
    tags: [{ name: 'orders' }],
    paths: {
      '/orders/{id}': {
        get: {
          operationId: 'readOrder',
          summary: 'Read one order',
          tags: ['orders'],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'currency', in: 'query', schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'The order',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/Order' } },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        Order: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string' }, amount: { type: 'integer' } },
        },
      },
    },
  };
}

const encoder = new TextEncoder();

/**
 * An asset plan made of bytes rather than of files.
 *
 * The stylesheet names the font on purpose, so the catalog's url rewriting is exercised by
 * every test that builds a service rather than only by the ones that mean to.
 *
 * @returns The plan
 */
export function assetPlan(): AssetPlan {
  return {
    sources: [
      { name: 'openref.js', bytes: encoder.encode('/* client bundle */\n') },
      {
        name: 'theme.css',
        bytes: encoder.encode("@font-face{src:url('./Face-400.woff2') format('woff2')}"),
      },
      { name: 'Face-400.woff2', bytes: encoder.encode('wOF2 not really') },
    ],
    stylesheetNames: ['theme.css'],
    moduleName: 'openref.js',
  };
}

/** One route registered on a fake adapter. */
export interface RecordedRoute {
  readonly pattern: string;
  readonly handler: (request: unknown, reply: unknown) => void;
}

/** A fake NestJS http adapter that records what was registered on it. */
export interface FakeHttpAdapter extends HttpAdapterLike {
  readonly routes: RecordedRoute[];
}

/**
 * Builds a fake http adapter.
 *
 * @param platform - What `getType` should report
 * @returns The adapter and the routes registered on it
 */
export function fakeHttpAdapter(platform = 'express'): FakeHttpAdapter {
  const routes: RecordedRoute[] = [];

  return {
    routes,
    getType: () => platform,
    get(pattern, handler) {
      routes.push({ pattern, handler });
      return undefined;
    },
  };
}

/** A fake Express response that records what was written to it. */
export interface FakeExpressResponse {
  statusCode: number;
  readonly headers: Record<string, string>;
  body: string | Uint8Array | null;
  readonly locals: Record<string, unknown>;
  setHeader(name: string, value: string): void;
  end(chunk: string | Uint8Array): void;
}

/**
 * Builds a fake Express response.
 *
 * @param locals - Contents of `res.locals`, where a helmet integration leaves a nonce
 * @returns The response
 */
export function fakeExpressResponse(locals: Record<string, unknown> = {}): FakeExpressResponse {
  const headers: Record<string, string> = {};

  return {
    statusCode: 0,
    headers,
    body: null,
    locals,
    setHeader(name, value) {
      headers[name] = value;
    },
    end(chunk) {
      this.body = chunk;
    },
  };
}

/** A fake Fastify reply that records what was written to it. */
export interface FakeFastifyReply {
  statusCode: number;
  readonly headers: Record<string, string>;
  body: string | Uint8Array | null;
  readonly cspNonce?: { script: string };
  status(code: number): FakeFastifyReply;
  header(name: string, value: string): FakeFastifyReply;
  send(payload: string | Uint8Array): FakeFastifyReply;
}

/**
 * Builds a fake Fastify reply.
 *
 * @param nonce - Nonce `@fastify/helmet` would have left on it
 * @returns The reply
 */
export function fakeFastifyReply(nonce?: string): FakeFastifyReply {
  const headers: Record<string, string> = {};

  const reply: FakeFastifyReply = {
    statusCode: 0,
    headers,
    body: null,
    ...(nonce === undefined ? {} : { cspNonce: { script: nonce } }),
    status(code) {
      reply.statusCode = code;
      return reply;
    },
    header(name, value) {
      headers[name] = value;
      return reply;
    },
    send(payload) {
      reply.body = payload;
      return reply;
    },
  };

  return reply;
}
