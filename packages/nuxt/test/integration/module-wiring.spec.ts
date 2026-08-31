import { cp, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BUILD_MANIFEST_FILE } from '@openref/static';
import {
  GENERATED_ASSET_DIRECTORY,
  GENERATED_DIRECTORY,
  generatedEntryFile,
  nitroProxyFile,
  nitroProxyRoute,
  openRefNuxtModule,
  prerenderIgnorePattern,
  PROXY_ENTRY,
  REFERENCE_ENTRY,
} from '../../src/index';
import type { NitroConfigSurface, NitroSurface, NuxtSurface } from '../../src/index';

/**
 * The module driven against a stand in for Nuxt, over a real directory.
 *
 * A STAND IN FOR NUXT AND A REAL DISK, WHICH IS THE SPLIT THAT MATTERS. What Nuxt does with the
 * configuration is Nuxt's, and `nuxt-parity.spec.ts` runs the real thing; what this suite can say,
 * and say per branch, is what the module puts into the configuration and onto the disk. The two
 * halves of SPEC 16.4 are mutually exclusive, and a stand in is how both branches are reachable
 * in one run.
 *
 * IT NEEDS THE WORKSPACE BUILT, because the default assets are `@openref/theme`'s files and
 * `@openref/nest/browser`. It refuses rather than skips, for the reason `vitest.built-cli.ts`
 * gives: a skipped suite and a passing suite look identical from the outside.
 */

const SPEC_FIXTURE = fileURLToPath(
  new URL('../../../../examples/nuxt-reference/openapi.yaml', import.meta.url),
);

const CLIENT_BUNDLE = fileURLToPath(
  new URL('../../../nest/dist/browser/openref.js', import.meta.url),
);

/** What the module wrote into the configuration, in the order it wrote it. */
interface CapturedNitro extends NitroConfigSurface {
  handlers: NonNullable<NitroConfigSurface['handlers']>;
  publicAssets: NonNullable<NitroConfigSurface['publicAssets']>;
  prerender: NonNullable<NitroConfigSurface['prerender']>;
}

/** A Nuxt that records rather than builds. */
interface FakeNuxt extends NuxtSurface {
  /** Runs `nitro:config` with the flags a real build would carry. */
  configure(isStatic: boolean | undefined): CapturedNitro;
  /** Runs `nitro:build:public-assets` against a public directory. */
  publish(publicDir: string): Promise<void>;
}

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
    configure(isStatic: boolean | undefined): CapturedNitro {
      const config: NitroConfigSurface = {
        ...(isStatic === undefined ? {} : { static: isStatic }),
        handlers: [],
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
  if (!(await stat(CLIENT_BUNDLE).catch(() => null))) {
    throw new Error(
      `${CLIENT_BUNDLE} is not there, and it is the client bundle every page links. Run \`pnpm build\` first. This suite refuses to skip itself, because a skipped run and a passing run look identical from the outside`,
    );
  }

  root = await mkdtemp(join(tmpdir(), 'openref-nuxt-'));
  await cp(SPEC_FIXTURE, join(root, 'openapi.yaml'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('the module under a server deployment', () => {
  it('should register the mount and its catch all, publish the assets and write no page', async () => {
    // Given
    const nuxt = fakeNuxt(root, { spec: './openapi.yaml', base: '/docs' });
    await openRefNuxtModule(undefined, nuxt);

    // When
    const config = nuxt.configure(undefined);
    const publicDir = join(root, 'public');
    await nuxt.publish(publicDir);

    // Then
    expect(config.handlers.map((entry) => entry.route)).toEqual(['/docs', '/docs/**']);
    expect(config.publicAssets.map((entry) => entry.baseURL)).toEqual(['/docs/_assets']);
    expect(config.publicAssets[0]?.dir).toBe(
      join(root, GENERATED_DIRECTORY, GENERATED_ASSET_DIRECTORY),
    );
    expect(await stat(publicDir).catch(() => null)).toBeNull();
  });

  it('should write the generated entry with the specification in it', async () => {
    // Given
    const nuxt = fakeNuxt(root, { spec: './openapi.yaml', base: '/docs' });
    await openRefNuxtModule(undefined, nuxt);

    // When
    nuxt.configure(undefined);
    const entry = await readFile(
      join(root, GENERATED_DIRECTORY, generatedEntryFile(REFERENCE_ENTRY, '/docs')),
      'utf8',
    );

    // Then
    expect(entry).toContain('createReferenceHandler(');
    expect(entry).toContain('Parcels');
    expect(entry).toContain('"base": "/docs"');
  });

  it('should publish every asset under its served name, which is what the pages link', async () => {
    // Given
    const nuxt = fakeNuxt(root, { spec: './openapi.yaml', base: '/docs' });
    await openRefNuxtModule(undefined, nuxt);

    // When
    nuxt.configure(undefined);
    const entry = await readFile(
      join(root, GENERATED_DIRECTORY, generatedEntryFile(REFERENCE_ENTRY, '/docs')),
      'utf8',
    );
    const embedded = /createReferenceHandler\((?<site>[\s\S]*)\);/u.exec(entry)?.groups?.site;
    const site = JSON.parse(embedded ?? '{}') as {
      assets: { servedNames: Record<string, string>; moduleName: string };
    };

    // Then
    const names = Object.values(site.assets.servedNames);
    expect(names.length).toBeGreaterThan(5);

    for (const name of names) {
      expect(
        await stat(join(root, GENERATED_DIRECTORY, GENERATED_ASSET_DIRECTORY, name)).catch(
          () => null,
        ),
      ).not.toBeNull();
    }
  });
});

describe('the module under a static deployment', () => {
  it('should register no route and write the whole site into the public directory', async () => {
    // Given
    const nuxt = fakeNuxt(root, { spec: './openapi.yaml', base: '/docs' });
    await openRefNuxtModule(undefined, nuxt);

    // When
    const config = nuxt.configure(true);
    const publicDir = join(root, 'public');
    await nuxt.publish(publicDir);

    // Then
    expect(config.handlers).toEqual([]);
    expect(config.publicAssets).toEqual([]);
    expect(await readFile(join(publicDir, 'docs', 'index.html'), 'utf8')).toContain('Parcels');
    expect(
      await stat(join(publicDir, 'docs', BUILD_MANIFEST_FILE)).catch(() => null),
    ).not.toBeNull();
  });

  it('should keep the prerenderer out of the mount in both deployments, which is the second writer it would otherwise be', async () => {
    // Given
    const nuxt = fakeNuxt(root, { spec: './openapi.yaml', base: '/docs' });
    await openRefNuxtModule(undefined, nuxt);

    // When
    const served = nuxt.configure(undefined);
    const generated = nuxt.configure(true);

    // Then
    expect(served.prerender.ignore).toEqual([prerenderIgnorePattern('/docs')]);
    expect(generated.prerender.ignore).toEqual([prerenderIgnorePattern('/docs')]);
  });
});

describe('the proxy route of SPEC 16.2', () => {
  it('should be registered from the generator and kept out of the published directory', async () => {
    // Given
    const nuxt = fakeNuxt(root, { spec: './openapi.yaml', base: '/docs', target: 'nitro' });
    await openRefNuxtModule(undefined, nuxt);

    // When
    const config = nuxt.configure(true);
    const publicDir = join(root, 'public');
    await nuxt.publish(publicDir);

    // Then
    const registered = config.handlers.find((entry) => entry.route === nitroProxyRoute('/docs'));
    expect(registered?.handler).toBe(
      join(root, GENERATED_DIRECTORY, generatedEntryFile(PROXY_ENTRY, '/docs')),
    );
    expect(await readFile(registered?.handler ?? '', 'utf8')).toContain(
      'https://api.parcels.example.com/v1',
    );
    expect(
      await stat(join(publicDir, 'docs', nitroProxyFile('/docs'))).catch(() => null),
    ).toBeNull();
  });

  it('should register nothing when no target was named, which is the SPEC 16.2 posture', async () => {
    // Given
    const nuxt = fakeNuxt(root, { spec: './openapi.yaml', base: '/docs' });
    await openRefNuxtModule(undefined, nuxt);

    // When
    const config = nuxt.configure(true);

    // Then
    expect(config.handlers.some((entry) => entry.route.includes('_proxy'))).toBe(false);
    expect(
      await stat(join(root, GENERATED_DIRECTORY, generatedEntryFile(PROXY_ENTRY, '/docs'))).catch(
        () => null,
      ),
    ).toBeNull();
  });
});

describe('inline options beside the module', () => {
  it('should win over the configuration key, which is what an inline option is for', async () => {
    // Given
    const nuxt = fakeNuxt(root, { spec: './openapi.yaml', base: '/docs' });

    // When
    await openRefNuxtModule({ base: '/reference' }, nuxt);
    const config = nuxt.configure(undefined);

    // Then
    expect(config.handlers.map((entry) => entry.route)).toEqual(['/reference', '/reference/**']);
  });
});
