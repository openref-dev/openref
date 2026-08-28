import { describe, expect, it } from 'vitest';
import {
  BUILD_TARGETS,
  detectTarget,
  DIRECT_TARGETS,
  isBuildTarget,
  isDirectTarget,
  isProxyConfigTarget,
  PROXY_CONFIG_TARGETS,
  targetLabel,
} from '../../src/index';

describe('isBuildTarget', () => {
  it('should accept every target of SPEC 16.2, both capability kinds and none', () => {
    // Given
    const all = [...PROXY_CONFIG_TARGETS, ...DIRECT_TARGETS, 'none'];

    // When
    const verdicts = all.map((target) => isBuildTarget(target));

    // Then: seven config targets, three direct targets, and the explicit nothing.
    expect(all).toHaveLength(11);
    expect(BUILD_TARGETS).toHaveLength(11);
    expect(verdicts.every((verdict) => verdict)).toBe(true);
  });

  it('should reject a name that is not a target, auto included', () => {
    // Given: auto is a detection instruction, not a resolved target.
    const junk = ['auto', 'AWS', 'netlify ', '', 'github'];

    // When
    const verdicts = junk.map((value) => isBuildTarget(value));

    // Then
    expect(verdicts.every((verdict) => !verdict)).toBe(true);
  });

  it('should classify each target exactly once', () => {
    // When: each target satisfies exactly one of the three kinds.
    const kinds = BUILD_TARGETS.map(
      (target) =>
        [isProxyConfigTarget(target), isDirectTarget(target), target === 'none'].filter(
          (verdict) => verdict,
        ).length,
    );

    // Then
    expect(kinds).toEqual(BUILD_TARGETS.map(() => 1));
  });

  it('should name every target for a reader', () => {
    // When
    const labels = BUILD_TARGETS.map((target) => targetLabel(target));

    // Then
    expect(labels.every((label) => label.length > 0)).toBe(true);
    expect(targetLabel('github-pages')).toBe('GitHub Pages');
  });
});

describe('detectTarget, the auto detection of SPEC 16.2', () => {
  it('should detect each platform from its own variable', () => {
    // Given, When, Then
    expect(detectTarget({ NETLIFY: 'true' })).toEqual({ target: 'netlify' });
    expect(detectTarget({ VERCEL: '1' })).toEqual({ target: 'vercel' });
    expect(detectTarget({ CF_PAGES: '1' })).toEqual({ target: 'cloudflare-pages' });
  });

  it('should fall back to none with a warning when no platform variable is set', () => {
    // Given: a CI variable is not a platform variable, per the SPEC 16.2 list.
    const detection = detectTarget({ GITHUB_ACTIONS: 'true', PATH: '/usr/bin' });

    // Then
    expect(detection.target).toBe('none');
    expect(detection.warning).toContain('none of NETLIFY, VERCEL or CF_PAGES');
    expect(detection.warning).toContain('no proxy configuration is generated');
  });

  it('should refuse to pick between two platforms rather than defaulting to one', () => {
    // Given: a machine claiming to be two platforms is a fact this check cannot determine,
    // and the answer meaning success is never the default.
    const detection = detectTarget({ NETLIFY: 'true', VERCEL: '1' });

    // Then
    expect(detection.target).toBe('none');
    expect(detection.warning).toContain('NETLIFY');
    expect(detection.warning).toContain('VERCEL');
    expect(detection.warning).toContain('cannot be determined');
  });

  it('should read an empty variable as not set', () => {
    // Given: platforms set their variable to a value; an empty string is shell residue.
    const detection = detectTarget({ NETLIFY: '', VERCEL: '1' });

    // Then
    expect(detection).toEqual({ target: 'vercel' });
  });
});
