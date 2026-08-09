import { describe, expect, it } from 'vitest';
import { resolveShippedPackages, type WorkspaceManifest } from '../../src/lib/workspace';

function manifest(
  name: string,
  options: {
    readonly isPrivate?: boolean;
    readonly dependencies?: readonly string[];
    readonly developmentDependencies?: readonly string[];
  } = {},
): WorkspaceManifest {
  return {
    directory: `packages/${name.replace(/^@[^/]+\//, '')}`,
    name,
    isPrivate: options.isPrivate ?? false,
    dependencies: options.dependencies ?? [],
    developmentDependencies: options.developmentDependencies ?? [],
  };
}

describe('resolveShippedPackages', () => {
  it('should treat every package that is not private as published', () => {
    // Given
    const manifests = [manifest('@openref/core'), manifest('@openref/render', { isPrivate: true })];

    // When
    const result = resolveShippedPackages(manifests);

    // Then
    expect(result.published).toEqual(['@openref/core']);
  });

  it('should treat a private package in devDependencies of a published one as bundled', () => {
    // Given, the shape @openref/nest actually has: internals are dev deps because bundled
    const manifests = [
      manifest('@openref/nest', { developmentDependencies: ['@openref/render', 'tsup'] }),
      manifest('@openref/render', { isPrivate: true }),
    ];

    // When
    const result = resolveShippedPackages(manifests);

    // Then
    expect(result.bundled).toEqual(['@openref/render']);
    expect(result.shipped).toEqual(['@openref/nest', '@openref/render']);
  });

  it('should follow bundling transitively through a chain of private packages', () => {
    // Given
    const manifests = [
      manifest('@openref/nest', { developmentDependencies: ['@openref/render'] }),
      manifest('@openref/render', { isPrivate: true, dependencies: ['@openref/theme-kit'] }),
      manifest('@openref/theme-kit', { isPrivate: true }),
    ];

    // When
    const result = resolveShippedPackages(manifests);

    // Then
    expect(result.bundled).toEqual(['@openref/render', '@openref/theme-kit']);
  });

  it('should leave a private package that nothing published reaches out of the shipped set', () => {
    // Given, the gates tool itself
    const manifests = [manifest('@openref/core'), manifest('@openref/gates', { isPrivate: true })];

    // When
    const result = resolveShippedPackages(manifests);

    // Then
    expect(result.shipped).toEqual(['@openref/core']);
  });

  it('should terminate on a cycle between two private packages', () => {
    // Given
    const manifests = [
      manifest('@openref/nest', { developmentDependencies: ['@openref/render'] }),
      manifest('@openref/render', { isPrivate: true, dependencies: ['@openref/runner'] }),
      manifest('@openref/runner', { isPrivate: true, dependencies: ['@openref/render'] }),
    ];

    // When
    const result = resolveShippedPackages(manifests);

    // Then
    expect(result.bundled).toEqual(['@openref/render', '@openref/runner']);
  });
});
