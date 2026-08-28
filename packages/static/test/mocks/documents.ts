import { normalizeOpenApiDocument, type IRDocument } from '@openref/core';
import type { AssetSource } from '@openref/render';
import type { IOutputStore } from '../../src/index';

/** The specification the build fixtures are variations of. */
export interface SpecOptions {
  /** Summary of the second operation, the one a variation moves. */
  readonly pongSummary?: string;
  /** Description of the second operation's response, which no navigation entry carries. */
  readonly pongResponse?: string;
  /** Whether the third operation exists at all. */
  readonly withThird?: boolean;
  /** Servers the document declares, for the proxy cases. Absent keeps the T004-R1 default. */
  readonly servers?: readonly { readonly url: string }[];
}

/**
 * A small document with two operations and a schema.
 *
 * TWO OPERATIONS BECAUSE ONE CANNOT SHOW AN INCREMENTAL REBUILD. The point of every case here
 * is what happens to the page that did NOT change, and a document with one page has none.
 *
 * @param options - What this variation changes
 * @returns The normalized document
 */
export function miniDocument(options: SpecOptions = {}): IRDocument {
  const paths: Record<string, unknown> = {
    '/ping': {
      get: {
        operationId: 'ping',
        summary: 'Ping',
        responses: {
          200: {
            description: 'ok',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Pong' } },
            },
          },
        },
      },
    },
    '/pong': {
      get: {
        operationId: 'pong',
        summary: options.pongSummary ?? 'Pong',
        responses: { 200: { description: options.pongResponse ?? 'ok' } },
      },
    },
  };

  if (options.withThird === true) {
    paths['/pang'] = {
      get: { operationId: 'pang', summary: 'Pang', responses: { 200: { description: 'ok' } } },
    };
  }

  return normalizeOpenApiDocument({
    openapi: '3.1.0',
    info: { title: 'Mini', version: '1.0.0', description: 'A **small** reference.' },
    ...(options.servers === undefined ? {} : { servers: options.servers }),
    paths,
    components: {
      schemas: {
        Pong: {
          type: 'object',
          properties: { at: { type: 'string', format: 'date-time' } },
          required: ['at'],
        },
      },
    },
  });
}

/** Assets that are bytes rather than files, so no test reads a build output directory. */
export function fixtureAssets(): {
  readonly sources: readonly AssetSource[];
  readonly stylesheetNames: readonly string[];
  readonly moduleName: string;
} {
  const encoder = new TextEncoder();

  return {
    sources: [
      { name: 'theme.css', bytes: encoder.encode('.oref-body{color:var(--oref-color-fg)}') },
      { name: 'openref.js', bytes: encoder.encode('export const hydrate = () => undefined;') },
    ],
    stylesheetNames: ['theme.css'],
    moduleName: 'openref.js',
  };
}

/** An output store in memory, which is what makes two builds comparable without a disk. */
export class MemoryOutputStore implements IOutputStore {
  /** Every file written, in the order it was first written. */
  readonly files = new Map<string, string | Uint8Array>();

  /** Paths passed to `write` or `writeBytes`, including repeats, for counting work. */
  readonly writes: string[] = [];

  /** Paths passed to `remove`. */
  readonly removals: string[] = [];

  /** @inheritdoc */
  read(path: string): Promise<string | null> {
    const value = this.files.get(path);
    return Promise.resolve(typeof value === 'string' ? value : null);
  }

  /** @inheritdoc */
  write(path: string, contents: string): Promise<void> {
    this.files.set(path, contents);
    this.writes.push(path);
    return Promise.resolve();
  }

  /** @inheritdoc */
  writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    this.files.set(path, bytes);
    this.writes.push(path);
    return Promise.resolve();
  }

  /** @inheritdoc */
  remove(path: string): Promise<void> {
    this.files.delete(path);
    this.removals.push(path);
    return Promise.resolve();
  }

  /** The text of every file, for a byte for byte comparison of two builds. */
  snapshot(): Record<string, string> {
    const decoder = new TextDecoder();
    const out: Record<string, string> = {};

    for (const [path, value] of [...this.files].sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    )) {
      out[path] = typeof value === 'string' ? value : decoder.decode(value);
    }

    return out;
  }
}
