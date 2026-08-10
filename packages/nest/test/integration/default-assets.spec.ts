import { describe, expect, it } from 'vitest';
import { loadDefaultAssets } from '../../src/assets/infrastructure/adapters/package-assets.adapter';
import { buildAssetCatalog } from '../../src/assets/domain/asset-catalog';

/**
 * The assets a reference serves when a host configures nothing.
 *
 * This is the half of SPEC 2's first minute that has nothing to do with NestJS: one install
 * has to bring a theme, its fonts and the client bundle, resolved out of installed packages
 * rather than copied into this one. It needs a build, because two of the three come out of
 * `dist`, and a missing file is an error rather than a skip.
 */
describe('the default asset set', () => {
  it('should resolve the theme, its fonts and the client bundle from installed packages', () => {
    // Given
    const plan = loadDefaultAssets();

    // When
    const names = plan.sources.map((source) => source.name);

    // Then
    expect(plan.moduleName).toBe('openref.js');
    expect(plan.stylesheetNames).toEqual(['fonts.css', 'tokens.css', 'theme.css']);
    expect(names.filter((name) => name.endsWith('.woff2')).length).toBeGreaterThanOrEqual(10);
  });

  it('should carry every font its own stylesheet declares', () => {
    // Given
    const plan = loadDefaultAssets();
    const catalog = buildAssetCatalog(plan.sources);
    const fonts = new TextDecoder().decode(catalog.byName.get('fonts.css')?.bytes);

    // When
    const referenced = [...fonts.matchAll(/url\('\.\/([^']+)'\)/g)].map((match) => match[1] ?? '');
    const missing = referenced.filter((name) => !catalog.byServedName.has(name));

    // Then
    // The catalog rewrote every reference to a served name, so anything left unresolved would
    // be a face that ships in the stylesheet and 404s on the wire.
    expect(referenced.length).toBeGreaterThan(0);
    expect(missing).toEqual([]);
  });

  it('should serve the composed bundle rather than the renderer own one', () => {
    // Given
    const plan = loadDefaultAssets();
    const decoder = new TextDecoder();

    // When
    // `oref.credential.` comes from `@openref/runner` and reaches a bundle only by being used.
    // The renderer cannot import that package at all, so its presence identifies which of the
    // two browser builds is being served.
    //
    // LOOKED FOR ACROSS THE PLAN AND NOT IN THE ENTRY, since T011-R. The runner sits behind a
    // dynamic import now, so the entry no longer carries it and a check that read only the entry
    // would report the renderer's bundle being served when it is not. What the claim needs is
    // that the runner is among the bytes this host will answer for, which is what the plan is.
    const carriers = plan.sources.filter((source) =>
      decoder.decode(source.bytes).includes('oref.credential.'),
    );

    // Then
    expect(plan.sources.map((source) => source.name)).toContain('openref.js');
    expect(carriers).toHaveLength(1);
    expect(carriers[0]?.name).not.toBe('openref.js');
  });
});
