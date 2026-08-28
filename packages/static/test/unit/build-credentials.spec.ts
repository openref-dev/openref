import { normalizeOpenApiDocument, type IRDocument } from '@openref/core';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { buildSite, type BuildSiteOptions } from '../../src/index';
import { fixtureAssets, MemoryOutputStore } from '../mocks/documents';

/**
 * SPEC 19.7, second half: credentials reach neither the SSR output nor the static build. The
 * served half, `19.7a`, is proved in `packages/render/test/integration/try-it.spec.ts`, where a
 * typed credential is shown held by the runner and absent from the document. This file is the
 * static half, `19.7b`.
 *
 * THE SEPARATION IS THE PROMISE, SO THE PROOF IS THE TYPE, per the standing rule in
 * `ai-docs/BUILD-AMENDMENTS.md`: a credential lives with a runner behind the storage policy of
 * SPEC 14.4, and the build has no doorway a runner or a credential can enter by.
 * `BuildSiteOptions` is the whole doorway, this package depends on `core`, `render` and `search`
 * and never on `@openref/runner`, and the wrong version does not compile. The compile refusals
 * below are `@ts-expect-error`, which fails the build the day the refusal stops, and the root
 * tsconfig typechecks this tree, so `pnpm lint` is what arms them.
 *
 * WHAT THE BYTE WALK PROVES AND WHAT IT CANNOT. The walk asserts the subject present before it
 * asserts absence, because a proof of absence whose subject was never present proves nothing:
 * the same walker that will report absence is first shown finding the credential when it rides
 * the one doorway that admits arbitrary strings by construction, the document itself, whose
 * content the build publishes by design. That control is why the promise cannot be redaction and
 * is the closed doorway instead: a document that names a secret in its own prose is published as
 * written, and what `19.7b` promises is that the build machinery never has a credential of the
 * system's to leak. The true build then draws the very surface a credential would fill, the auth
 * control of the declared scheme, and no produced file carries the credential bytes.
 */

/** The credential, spelled the way the `19.7a` proof spells one. */
const CREDENTIAL = 'secret-bearer-token-19-7b';

/**
 * A document whose one operation requires a bearer scheme, so the pages draw the auth surface.
 *
 * @param description - Prose planted on the operation, for the control build
 * @returns The normalized document
 */
function securedDocument(description?: string): IRDocument {
  return normalizeOpenApiDocument({
    openapi: '3.1.0',
    info: { title: 'Secured', version: '1.0.0' },
    components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } },
    paths: {
      '/orders/{id}': {
        get: {
          operationId: 'getOrder',
          summary: 'Read one order',
          ...(description === undefined ? {} : { description }),
          security: [{ bearer: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'ok' } },
        },
      },
    },
  });
}

/** Every produced file whose text carries the credential bytes. */
function filesCarrying(store: MemoryOutputStore, credential: string): string[] {
  return Object.entries(store.snapshot())
    .filter(([, text]) => text.includes(credential))
    .map(([file]) => file);
}

describe('SPEC 19.7b, no credential reaches a static build', () => {
  it('should admit no credential through the build options, at compile time', async () => {
    // Given a build call that is valid in every other respect. It is run for real below, so
    // the base shape demonstrably compiles and the refusals can only be eating the one error
    // each is written for.
    const document = securedDocument();
    const store = new MemoryOutputStore();
    const assets = fixtureAssets();

    // When the wrong versions are written out, each the call a build with a credential
    // doorway would accept
    const attempts = (): void => {
      // @ts-expect-error the build options admit no credentials member
      void buildSite({ document, store, assets, credentials: { bearer: CREDENTIAL } });

      // @ts-expect-error the build options admit no runner to hold a credential either
      void buildSite({ document, store, assets, runner: { credential: () => CREDENTIAL } });
    };
    void attempts;

    // Then the doorway type carries no property a credential could ride in on
    expectTypeOf<BuildSiteOptions>().not.toHaveProperty('credentials');
    expectTypeOf<BuildSiteOptions>().not.toHaveProperty('runner');
    expectTypeOf<BuildSiteOptions>().not.toHaveProperty('auth');

    // And the valid call is the one that compiles and runs
    const report = await buildSite({ document, store, assets });
    expect(report.rendered.length).toBeGreaterThan(0);
  });

  it('should carry the credential into no built file, with the walker first shown seeing one', async () => {
    // Given the subject present first: the credential planted where arbitrary strings can
    // enter by construction, the document's own prose, asserted present in that input state
    const planted = securedDocument(`Send ${CREDENTIAL} in the Authorization header.`);
    const [plantedNode] = [...planted.nodes.values()];
    expect(plantedNode?.description).toContain(CREDENTIAL);

    // And the walker shown finding it in the built files, so a later empty walk is a
    // statement about the build rather than about a walker that sees nothing
    const controlStore = new MemoryOutputStore();
    await buildSite({ document: planted, store: controlStore, assets: fixtureAssets() });
    expect(filesCarrying(controlStore, CREDENTIAL).length).toBeGreaterThan(0);

    // When the same site is built with the credential nowhere the types admit
    const store = new MemoryOutputStore();
    const report = await buildSite({
      document: securedDocument(),
      store,
      assets: fixtureAssets(),
    });

    // Then the pages drew the very surface a credential would fill: the bench page carries
    // the auth control of the declared scheme
    const snapshot = store.snapshot();
    const bench = Object.entries(snapshot).find(([file]) => file.startsWith('bench/'));
    expect(bench?.[1]).toContain('oref-field-auth-bearer');

    // And no produced file carries the credential bytes, every file walked
    expect(report.rendered.length + report.files.length).toBeGreaterThan(0);
    expect(Object.keys(snapshot).length).toBe(report.rendered.length + report.files.length);
    expect(filesCarrying(store, CREDENTIAL)).toEqual([]);
  });
});
