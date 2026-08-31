import { describe, expect, it } from 'vitest';
import { InvalidOptionsError } from '@openref/core';
import { generatesStatically, resolveNuxtOptions } from '../../src/index';

/**
 * What `nuxt.config` may say, and what it may not.
 *
 * EVERY REFUSAL HERE IS A DEPLOYMENT THAT CANNOT BE FIXED LATER, which is why they are refusals
 * at configuration time rather than warnings in a log nobody reads after a deploy.
 */
describe('resolveNuxtOptions', () => {
  it('should refuse a mount at the site root, naming the collision rather than picking a winner', () => {
    // Given
    const options = { spec: './openapi.yaml', base: '/' };

    // When
    const refusal = (): unknown => resolveNuxtOptions(options);

    // Then
    expect(refusal).toThrow(InvalidOptionsError);
    expect(refusal).toThrow(/site root/);
    expect(refusal).toThrow(/index\.html/);
  });

  it('should refuse a missing specification, since there is nothing to mount without one', () => {
    // Given
    const options = { base: '/docs' };

    // When
    const refusal = (): unknown => resolveNuxtOptions(options);

    // Then
    expect(refusal).toThrow(/needs "spec"/);
  });

  it('should refuse a missing base, since the module never chooses the mount itself', () => {
    // Given
    const options = { spec: './openapi.yaml' };

    // When
    const refusal = (): unknown => resolveNuxtOptions(options);

    // Then
    expect(refusal).toThrow(/needs "base"/);
  });

  it('should refuse a target that names no platform, listing the ones that do', () => {
    // Given
    const options = { spec: './openapi.yaml', base: '/docs', target: 'nitro-ish' };

    // When
    const refusal = (): unknown =>
      resolveNuxtOptions(options as unknown as Parameters<typeof resolveNuxtOptions>[0]);

    // Then
    expect(refusal).toThrow(/"target" must be one of/);
    expect(refusal).toThrow(/cloudflare-pages/);
  });

  it('should refuse a generate value that is neither a boolean nor auto', () => {
    // Given
    const options = { spec: './openapi.yaml', base: '/docs', generate: 'sometimes' };

    // When
    const refusal = (): unknown =>
      resolveNuxtOptions(options as unknown as Parameters<typeof resolveNuxtOptions>[0]);

    // Then
    expect(refusal).toThrow(/"generate" is true, false or "auto"/);
  });

  it('should take the mount path out of an absolute base, which is what a sitemap needs', () => {
    // Given
    const options = { spec: './openapi.yaml', base: 'https://parcels.example.com/docs' };

    // When
    const resolved = resolveNuxtOptions(options);

    // Then
    expect(resolved.basePath).toBe('/docs');
    expect(resolved.base).toBe('https://parcels.example.com/docs');
  });

  it('should default the proxy to nothing at all, which is the SPEC 16.2 posture', () => {
    // Given
    const options = { spec: './openapi.yaml', base: '/docs' };

    // When
    const resolved = resolveNuxtOptions(options);

    // Then
    expect(resolved.target).toBeUndefined();
    expect(resolved.forwardCookies).toBe(false);
    expect(resolved.generate).toBe('auto');
  });
});

describe('generatesStatically', () => {
  it('should follow Nitro under auto, so the static deployment writes and the server renders', () => {
    // Given
    const auto = 'auto' as const;

    // When
    const underGenerate = generatesStatically(auto, true);
    const underBuild = generatesStatically(auto, undefined);

    // Then
    expect(underGenerate).toBe(true);
    expect(underBuild).toBe(false);
  });

  it('should let a host override the deployment in both directions', () => {
    // Given
    const staticBuild = true;

    // When
    const forcedOff = generatesStatically(false, staticBuild);
    const forcedOn = generatesStatically(true, undefined);

    // Then
    expect(forcedOff).toBe(false);
    expect(forcedOn).toBe(true);
  });
});
