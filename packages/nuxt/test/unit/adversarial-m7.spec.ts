import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildAssetCatalog, loadDefaultAssets } from '@openref/render';
import { resolveSiteBase } from '@openref/static';
import {
  GENERATED_DIRECTORY,
  generatedEntryFile,
  loadSpecification,
  openRefNuxtModule,
  prerenderIgnorePattern,
  PROXY_ENTRY,
  REFERENCE_ENTRY,
  resolveNuxtOptions,
  servesReference,
} from '../../src/index';
import { createSite } from '../../src/runtime/site';
import type {
  NitroConfigSurface,
  NitroHandlerEntry,
  NitroSurface,
  NuxtSurface,
} from '../../src/index';

/**
 * The adversarial pass of `T062` over what M7 built, one case per thing that broke.
 *
 * EVERY CASE HERE WAS RED ON THE CODE AS `T061` LEFT IT, and the input that made it red is written
 * in the case rather than described. The five findings, in the order they were measured: two
 * mounts in one project wrote one generated entry and served one document from both; the
 * prerenderer was told to stay out of every path that merely begins with the base; a symbolic link
 * at the mount carried the whole reference out of the public directory; a plain file at the same
 * place produced a raw `EEXIST` from `mkdir` in a store whose purpose is a named refusal; and a
 * named pipe as the specification hung the build with no output at all. The sixth is a bypass of a
 * refusal rather than a crash: a base spelled with `%2F` decodes to the site root, which SPEC 16.4
 * refuses by name and could not see through an escape.
 *
 * A PROOF OF ABSENCE ASSERTS THE SUBJECT FIRST, which is why the prerender case checks that the
 * pattern matches the mount and its subtree before it checks that it does not match the sibling.
 */

const SPEC_FIXTURE = fileURLToPath(
  new URL('../../../../examples/nuxt-reference/openapi.yaml', import.meta.url),
);

const SECOND_DOCUMENT = [
  'openapi: 3.1.0',
  'info:',
  '  title: Second Service',
  '  version: "1.0.0"',
  'paths: {}',
  '',
].join('\n');

interface CapturedNitro extends NitroConfigSurface {
  handlers: NonNullable<NitroConfigSurface['handlers']>;
  publicAssets: NonNullable<NitroConfigSurface['publicAssets']>;
  prerender: NonNullable<NitroConfigSurface['prerender']>;
}

interface FakeNuxt extends NuxtSurface {
  configure(isStatic: boolean | undefined, handlers?: readonly NitroHandlerEntry[]): CapturedNitro;
  publish(publicDir: string): Promise<void>;
}

/** The stand in `module-wiring.spec.ts` uses, so both suites drive the module the same way. */
function fakeNuxt(rootDir: string, openref: unknown): FakeNuxt {
  const configHooks: ((config: NitroConfigSurface) => void)[] = [];
  const assetHooks: ((nitro: NitroSurface) => void | Promise<void>)[] = [];

  return {
    options: { rootDir, buildDir: join(rootDir, '.nuxt'), openref },
    hook(name: string, handler: unknown): void {
      if (name === 'nitro:config') {
        configHooks.push(handler as (config: NitroConfigSurface) => void);
        return;
      }
      assetHooks.push(handler as (nitro: NitroSurface) => void | Promise<void>);
    },
    configure(
      isStatic: boolean | undefined,
      handlers: readonly NitroHandlerEntry[] = [],
    ): CapturedNitro {
      const config: NitroConfigSurface = {
        ...(isStatic === undefined ? {} : { static: isStatic }),
        handlers: [...handlers],
        publicAssets: [],
        prerender: { ignore: [] },
      };

      for (const hook of configHooks) hook(config);

      return config as CapturedNitro;
    },
    async publish(publicDir: string): Promise<void> {
      for (const hook of assetHooks) {
        await hook({ options: { output: { publicDir } } });
      }
    },
  };
}

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'openref-adv-m7-'));
  await cp(SPEC_FIXTURE, join(root, 'openapi.yaml'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('two references mounted in one project', () => {
  it('should give each mount its own generated entry, which is what the runtime memoization assumes', async () => {
    // Given two mounts of the module in one project, which `site.ts` states in its own header is a
    // thing an application may do. Before this fix both wrote `.openref/reference-handler.ts`.
    await writeFile(join(root, 'other.yaml'), SECOND_DOCUMENT, 'utf8');
    const first = fakeNuxt(root, { spec: './openapi.yaml', base: '/docs' });
    const second = fakeNuxt(root, { spec: './other.yaml', base: '/reference' });

    // When
    await openRefNuxtModule(undefined, first);
    const firstConfig = first.configure(undefined);
    await openRefNuxtModule(undefined, second);
    const secondConfig = second.configure(undefined);

    // Then: two entries, and each one carries its own document
    const firstEntry = firstConfig.handlers[0]?.handler ?? '';
    const secondEntry = secondConfig.handlers[0]?.handler ?? '';
    expect(firstEntry).not.toBe(secondEntry);
    expect(await readFile(firstEntry, 'utf8')).toContain('Parcels');
    expect(await readFile(firstEntry, 'utf8')).not.toContain('Second Service');
    expect(await readFile(secondEntry, 'utf8')).toContain('Second Service');
  }, 120000);

  it('should not fold two different mounts onto one file name, which no substitution of the separator can promise', () => {
    // Given two bases that any readable slug collapses onto one name
    const nested = generatedEntryFile(REFERENCE_ENTRY, '/a/b');
    const hyphenated = generatedEntryFile(REFERENCE_ENTRY, '/a-b');

    // When, Then
    expect(nested).not.toBe(hyphenated);
    expect(generatedEntryFile(PROXY_ENTRY, '/docs')).not.toBe(
      generatedEntryFile(REFERENCE_ENTRY, '/docs'),
    );
    expect(generatedEntryFile(REFERENCE_ENTRY, '/docs')).toBe(
      generatedEntryFile(REFERENCE_ENTRY, '/docs'),
    );
  });
});

describe('the prerenderer told to stay out of the mount', () => {
  it('should keep out of the mount and its subtree, and leave a sibling route alone', async () => {
    // Given the module configured at /docs
    const nuxt = fakeNuxt(root, { spec: './openapi.yaml', base: '/docs' });
    await openRefNuxtModule(undefined, nuxt);

    // When
    const config = nuxt.configure(true);
    const pattern = config.prerender.ignore?.[0];

    // Then the subject is present: the mount and its pages are excluded
    expect(pattern).toBeInstanceOf(RegExp);
    const matches = (path: string): boolean =>
      pattern instanceof RegExp ? pattern.test(path) : String(pattern) === path;
    expect(matches('/docs')).toBe(true);
    expect(matches('/docs/get-parcels')).toBe(true);

    // And only then the absence: a host page beside the mount is still prerendered. Nitro 2.13.4
    // compares a string pattern with `path.startsWith(pattern)`, in `matchesIgnorePattern`, so the
    // base written as a bare string excluded this route too, silently.
    expect(matches('/docs-legacy')).toBe(false);
    expect('/docs-legacy'.startsWith('/docs')).toBe(true);
  }, 120000);

  it('should build a pattern that cannot be widened by a base carrying regular expression syntax', () => {
    // Given a base a regular expression would read as syntax if it were interpolated raw. The
    // character class of `resolveSiteBase` allows the dot, so this is a base a host can write.
    const pattern = prerenderIgnorePattern('/a.b');

    // When, Then
    expect(pattern.test('/a.b')).toBe(true);
    expect(pattern.test('/axb')).toBe(false);
  });
});

describe('the mount directory, which is the one path the inner store does not verify', () => {
  it('should refuse a symbolic link at the mount rather than carrying the build through it', async () => {
    // Given a link planted where the reference is written, which a repository can commit under
    // `public/` and Nitro copies into the deployment
    const publicDir = join(root, 'public');
    const elsewhere = join(root, 'elsewhere');
    await mkdir(publicDir, { recursive: true });
    await mkdir(elsewhere, { recursive: true });
    await symlink(elsewhere, join(publicDir, 'docs'));

    const nuxt = fakeNuxt(root, { spec: './openapi.yaml', base: '/docs' });
    await openRefNuxtModule(undefined, nuxt);
    nuxt.configure(true);

    // When
    const attempt = nuxt.publish(publicDir);

    // Then
    await expect(attempt).rejects.toThrow(/symbolic link/);
    expect(await stat(join(elsewhere, 'index.html')).catch(() => null)).toBeNull();
  }, 120000);

  it('should name the file when the mount is somebody else, rather than reporting a raw mkdir failure', async () => {
    // Given a file where the mount directory belongs
    const publicDir = join(root, 'public');
    await mkdir(publicDir, { recursive: true });
    await writeFile(join(publicDir, 'docs'), 'the host put this here', 'utf8');

    const nuxt = fakeNuxt(root, { spec: './openapi.yaml', base: '/docs' });
    await openRefNuxtModule(undefined, nuxt);
    nuxt.configure(true);

    // When
    const attempt = nuxt.publish(publicDir);

    // Then: a sentence naming the path and what it is, not `EEXIST: file already exists, mkdir`
    await expect(attempt).rejects.toThrow(/is not a directory, and it is where the reference/);
    expect(await readFile(join(publicDir, 'docs'), 'utf8')).toBe('the host put this here');
  }, 120000);

  it('should still write a mount of two segments, which is the control this refusal must not break', async () => {
    // Given a nested mount and an empty public directory
    const publicDir = join(root, 'public');
    const nuxt = fakeNuxt(root, { spec: './openapi.yaml', base: '/docs/v1' });
    await openRefNuxtModule(undefined, nuxt);
    nuxt.configure(true);

    // When
    await nuxt.publish(publicDir);

    // Then
    expect(await readFile(join(publicDir, 'docs', 'v1', 'index.html'), 'utf8')).toContain(
      'Parcels',
    );
  }, 120000);
});

describe('a specification the module cannot read', () => {
  it('should refuse a named pipe by name instead of waiting for a writer that never comes', async () => {
    // Given a FIFO where the document should be. `readFile` on one blocks forever, so the Nuxt
    // build sat in this hook with no output at all.
    const fifo = join(root, 'pipe.yaml');
    execFileSync('mkfifo', [fifo]);

    // When
    const outcome = await Promise.race([
      loadSpecification('pipe.yaml', root).then(
        () => 'read',
        (error: unknown) => (error instanceof Error ? error.message : String(error)),
      ),
      new Promise<string>((resolve) => {
        setTimeout(() => {
          resolve('HUNG');
        }, 4000);
      }),
    ]);

    // Then
    expect(outcome).toContain('a named pipe');
  }, 20000);

  it('should still report an absent document in the words the system used, which is the control', async () => {
    // Given nothing at the path

    // When
    const attempt = loadSpecification('missing.yaml', root);

    // Then
    await expect(attempt).rejects.toThrow(/could not be read from/);
  });
});

describe('a base spelled so that a platform reads it as another address', () => {
  it.each(['/docs%2F..%2F..', '/a%2F..', '/docs%2e%2e%2f'])(
    'should refuse %s, which one decode turns into a different path',
    (base) => {
      // Given a base whose escapes decode to dot segments. The character class allows `%`, `/` and
      // `.` one at a time, so this walked past it, and `/a%2F..` decodes to the site root, which is
      // the one configuration SPEC 16.4 says a deployment cannot recover from.
      //
      // WHICH RULE FIRES IS THE ESCAPE RULE AND NOT THE SITE ROOT ONE, and the assertion below says
      // so rather than settling for any refusal. It fires strictly earlier, inside `resolveSiteBase`
      // and before a `basePath` exists to be tested for emptiness, and it refuses a superset: every
      // base whose decode changes the path, not only the ones that decode to the root. So it is at
      // least as strong, and the message a reader gets names the decode rather than the collision.
      // When
      const throughStatic = (): unknown => resolveSiteBase(base);
      const throughModule = (): unknown => resolveNuxtOptions({ spec: 'x.yaml', base });

      // Then, and the message is asserted rather than the exception type, because "refused" and
      // "refused by the rule that says why" are two different facts
      expect(throughStatic).toThrow(/percent escape/);
      expect(throughModule).toThrow(/percent escape/);
      expect(throughModule).not.toThrow(/is the site root/);
    },
  );

  it('should keep accepting the bases a host actually writes, which is what says the rule is not a ban on bases', () => {
    // Given, When, Then
    expect(resolveNuxtOptions({ spec: 'x.yaml', base: '/docs' }).basePath).toBe('/docs');
    expect(resolveNuxtOptions({ spec: 'x.yaml', base: '/docs/v1.2' }).basePath).toBe('/docs/v1.2');
    expect(resolveNuxtOptions({ spec: 'x.yaml', base: 'https://x.example.com/api' }).basePath).toBe(
      '/api',
    );
  });
});

describe('a host that already answers where the reference mounts', () => {
  it.each([
    ['the mount itself', '/docs'],
    ['the catch all under it', '/docs/**'],
  ])(
    'should refuse to register a second handler at %s rather than letting one silently win',
    async (_where, route) => {
      // Given an application whose own route table already carries that address, which is the third
      // attack bullet of the task text. Two handlers at one route is the failure SPEC 16.4 refuses on
      // disk, met on the router, where nothing said anything.
      const nuxt = fakeNuxt(root, { spec: './openapi.yaml', base: '/docs' });
      await openRefNuxtModule(undefined, nuxt);

      // When
      const attempt = (): unknown =>
        nuxt.configure(undefined, [{ route, handler: '/app/server/routes/docs.ts' }]);

      // Then both names are in the message, which is what makes the refusal actionable
      expect(attempt).toThrow(/already registers a route at/);
      expect(attempt).toThrow(/docs\.ts/);
    },
    120000,
  );

  it('should refuse a host proxy route at the address SPEC 16.2 generates into', async () => {
    // Given a host that proxies for itself under the reference's own proxy address
    const nuxt = fakeNuxt(root, { spec: './openapi.yaml', base: '/docs', target: 'nitro' });
    await openRefNuxtModule(undefined, nuxt);

    // When
    const attempt = (): unknown =>
      nuxt.configure(true, [{ route: '/docs/_proxy/**', handler: '/app/server/routes/proxy.ts' }]);

    // Then
    expect(attempt).toThrow(/already registers a route at "\/docs\/_proxy\/\*\*"/);
  }, 120000);

  it('should leave a host catch all alone, which is the control that says this is not a ban on routes', async () => {
    // Given an ordinary application with its own catch all, which Nitro orders by specificity
    const nuxt = fakeNuxt(root, { spec: './openapi.yaml', base: '/docs' });
    await openRefNuxtModule(undefined, nuxt);

    // When
    const config = nuxt.configure(undefined, [
      { route: '/**', handler: '/app/server/routes/catch-all.ts' },
      { route: '/docs-legacy', handler: '/app/server/routes/legacy.ts' },
    ]);

    // Then the reference registers beside them
    expect(config.handlers.map((entry) => entry.route)).toEqual([
      '/**',
      '/docs-legacy',
      '/docs',
      '/docs/**',
    ]);
  }, 120000);
});

describe('a host that already serves a Content-Security-Policy of its own', () => {
  it('should write no policy of its own and no nonce, which is the page the build writes', async () => {
    // Given the second attack bullet: an application with a global CSP. The module writes no
    // policy, by design, so what has to hold is that a page served without a host nonce carries no
    // nonce attribute at all rather than an empty one, which authorizes nothing under any policy.
    const text = await readFile(SPEC_FIXTURE, 'utf8');
    const assets = loadDefaultAssets({ resolveFrom: import.meta.url });
    const catalog = buildAssetCatalog(assets.sources);
    const site = createSite({
      specification: text,
      source: SPEC_FIXTURE,
      base: '/docs',
      target: null,
      forwardCookies: false,
      lang: null,
      colorScheme: null,
      assets: {
        servedNames: Object.fromEntries(catalog.assets.map((a) => [a.name, a.servedName])),
        stylesheetNames: assets.stylesheetNames,
        moduleName: assets.moduleName,
      },
    });
    const server = await site();

    // When: the host set its own header, so nothing put a nonce on the context
    const withHostPolicy = await server.answer('/docs', undefined);
    const withOwnNonce = await server.answer('/docs', 'r4nd0mBASE64value');

    // Then the subject is present in the other branch, and absent in this one
    expect(String(withOwnNonce?.body)).toContain('nonce="r4nd0mBASE64value"');
    expect(String(withHostPolicy?.body)).not.toContain('nonce=');
    expect(String(withHostPolicy?.body)).not.toContain('Content-Security-Policy');
  }, 120000);

  it('should scope the host plugin seam to the mount, which is where the example decides it', () => {
    // Given `servesReference`, which lives in `@openref/nuxt/runtime` beside the policy string
    // precisely so a suite can drive it: the corrected predicate first lived in `examples/`, where
    // no suite and no gate reads it.
    // When, Then the mount and its subtree, query and fragment included
    expect(servesReference('/docs', '/docs')).toBe(true);
    expect(servesReference('/docs/get-parcels', '/docs')).toBe(true);
    expect(servesReference('/docs?a=1', '/docs')).toBe(true);
    expect(servesReference('/docs#top', '/docs')).toBe(true);

    // And nothing beside it, which is the measured defect: a host page served under a strict
    // policy it was never proved against loses its own hydration payload
    expect(servesReference('/docs-legacy', '/docs')).toBe(false);
    expect(servesReference('/docsx', '/docs')).toBe(false);
    expect(servesReference('/doc', '/docs')).toBe(false);
    expect(servesReference('/adocs', '/docs')).toBe(false);

    // And a base carrying regular expression syntax cannot widen it
    expect(servesReference('/a.b', '/a.b')).toBe(true);
    expect(servesReference('/axb', '/a.b')).toBe(false);
  });
});

describe('the generated directory under an ordinary run', () => {
  it('should write nothing outside the project directory it was given', async () => {
    // Given
    const nuxt = fakeNuxt(root, { spec: './openapi.yaml', base: '/docs' });
    await openRefNuxtModule(undefined, nuxt);

    // When
    const config = nuxt.configure(undefined);

    // Then
    for (const handler of config.handlers) {
      expect(handler.handler.startsWith(join(root, GENERATED_DIRECTORY))).toBe(true);
    }
    for (const asset of config.publicAssets) {
      expect(asset.dir.startsWith(join(root, GENERATED_DIRECTORY))).toBe(true);
    }
  }, 120000);
});
