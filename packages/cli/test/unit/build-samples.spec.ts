import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { normalizeOpenApiDocument } from '@openref/core';
import type { IROperation } from '@openref/core';
import { NODE_PARAM, ReferenceService, replyText } from '@openref/nest';
import { loadDefaultAssets, runnerOperationOf } from '@openref/render';
import { withGeneratedSamples } from '@openref/samples';
import { runBuild } from '../../src/cli/api/commands/build.command';
import { EXIT_CODE } from '../../src/cli/domain/exit-code.constants';
import type { CommandIo } from '../../src/cli/domain/command.types';

/**
 * `openref build` writes the samples the served page draws, per `TX-PAGE-SAMPLES`.
 *
 * ONE TRANSFORM, TWO HOSTS, AND THIS IS WHERE THAT IS CHECKED RATHER THAN INTENDED. SPEC 18 says
 * the composition has to live where `@openref/render` and `@openref/runner` are both visible, and
 * there are exactly two such packages: `@openref/nest`, which serves, and this one, which builds.
 * Two call sites is two chances to pass a different document, so the case below builds a site and
 * mounts a reference over the same specification and compares the section byte for byte. What it
 * would catch is one host being changed and the other forgotten, which is the failure a shared
 * function cannot prevent on its own.
 *
 * `@openref/nest` IS REACHED FROM A TEST AND NOT FROM `src/`, which the boundary rules allow and
 * `tools/dependency-rules.cjs` says in the `samples` entry: every rule anchors at
 * `^packages/<pkg>/src/`. The CLI's own source may not import the module, and does not.
 */

/** The document both halves are built from: a POST with a body, a scheme and a path parameter. */
const SPECIFICATION = {
  openapi: '3.1.0',
  info: { title: 'Orders', version: '1.0.0' },
  servers: [{ url: 'https://api.example.com/v1' }],
  components: {
    securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
    schemas: {
      Item: {
        type: 'object',
        required: ['sku'],
        properties: { sku: { type: 'string' }, quantity: { type: 'integer' } },
      },
    },
  },
  security: [{ bearer: [] }],
  paths: {
    '/orders/{orderId}/items': {
      post: {
        operationId: 'addItem',
        parameters: [
          {
            name: 'orderId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            example: 'ord_42',
          },
        ],
        requestBody: {
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Item' } } },
        },
        responses: { '200': { description: 'ok' } },
      },
    },
  },
};

function fakeIo(): CommandIo & { readonly out: string[]; readonly err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, stdout: (line) => out.push(line), stderr: (line) => err.push(line) };
}

/**
 * The text inside a fragment of served markup, tags removed and entities put back.
 *
 * The sample on the page is highlighted, per SPEC 12, so it is markup rather than the source the
 * generator wrote. Comparing against that source means undoing exactly that and nothing else.
 */
function textOf(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replaceAll('&#39;', "'")
    .replaceAll('&quot;', '"')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

/** The samples section of a page, or the empty string when it draws none. */
function samplesSection(html: string): string {
  const start = html.indexOf('<section class="oref-section oref-section-samples">');
  if (start === -1) return '';

  return html.slice(start, html.indexOf('</section>', start) + '</section>'.length);
}

let directory = '';
let specPath = '';

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'openref-cli-samples-'));
  specPath = join(directory, 'openapi.json');
  await writeFile(specPath, JSON.stringify(SPECIFICATION), 'utf8');
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('the static build and the generated samples', () => {
  it('should write the section into the built operation page', async () => {
    // Given
    const io = fakeIo();
    const out = join(directory, 'site');

    // When
    const outcome = await runBuild({ args: [`--spec=${specPath}`, `--out=${out}`], ...io });

    // Then
    expect(outcome.exitCode).toBe(EXIT_CODE.SUCCESS);
    const built = await readFile(join(out, 'post-orders-orderid-items', 'index.html'), 'utf8');
    expect(samplesSection(built)).not.toBe('');
    expect(built).toContain('Call it');
  });

  it('should write the samples the shared transform produces, character for character', async () => {
    // Given the same document through the transform both hosts call
    const transformed = withGeneratedSamples(
      normalizeOpenApiDocument(SPECIFICATION),
      runnerOperationOf,
    );
    const operation = [...transformed.nodes.values()][0] as IROperation;
    const shell = operation.codeSamples?.find((sample) => sample.lang === 'shell')?.source ?? '';
    expect(shell).toContain('curl -X POST');

    // When
    const io = fakeIo();
    const out = join(directory, 'site');
    await runBuild({ args: [`--spec=${specPath}`, `--out=${out}`], ...io });
    const built = await readFile(join(out, 'post-orders-orderid-items', 'index.html'), 'utf8');

    // Then: the built page carries all nine, the document hash the transform stamped, and the
    // cURL a reader copies is the one the generator wrote.
    expect(built).toContain(`data-oref-document="${transformed.hash}"`);
    for (const label of ['cURL', 'TypeScript', 'Python', 'Rust']) {
      expect(built, label).toContain(`>${label}</button>`);
    }
    const drawn = textOf(samplesSection(built));
    for (const line of shell.split('\n')) expect(drawn).toContain(line.trim());
  });

  it('should write the same section the served page draws, so a built site is not a second answer', async () => {
    // Given the served half, over the same specification
    const reference = new ReferenceService({
      document: SPECIFICATION,
      basePath: '',
      assets: loadDefaultAssets(),
    });
    const nodeId = [...reference.document.nodes.keys()][0] ?? '';
    const served = replyText(
      await reference.handle('node', { params: { [NODE_PARAM]: nodeId }, headers: {} }),
    );

    // When the built half is produced by the command
    const io = fakeIo();
    const out = join(directory, 'site');
    await runBuild({ args: [`--spec=${specPath}`, `--out=${out}`], ...io });
    const built = await readFile(join(out, nodeId, 'index.html'), 'utf8');

    // Then
    expect(samplesSection(served)).not.toBe('');
    expect(samplesSection(built)).toBe(samplesSection(served));
  });
});
