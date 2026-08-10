import { describe, expect, it } from 'vitest';
import { mainThreadWorkOf, parsedBytesOf } from '../../src/measure';
import type { RendererCounters, ResourceRecord } from '../../src/measure';

/**
 * The two quantities SPEC 20 moves to once elapsed time stopped being resolvable on a shared
 * runner, in the only two places they can be tested without a browser.
 *
 * Everything else in the measurement needs a real navigation and is proved on the runner. These
 * two are arithmetic over what the browser hands back, and both have a way of being wrong that
 * looks exactly like a small number: a counter that carried the harness's own calibration, and a
 * font counted as a stylesheet.
 */

/** Counters as the protocol reports them, in seconds. */
function counters(overrides: Partial<RendererCounters> = {}): RendererCounters {
  return {
    taskSeconds: 0,
    scriptSeconds: 0,
    recalcStyleSeconds: 0,
    layoutSeconds: 0,
    otherSeconds: 0,
    ...overrides,
  };
}

/** One subresource, with only the fields the split reads. */
function resource(name: string, initiatorType: string, decodedBytes: number): ResourceRecord {
  return { name, initiatorType, startMs: 0, endMs: 0, encodedBytes: 0, decodedBytes };
}

describe('mainThreadWorkOf', () => {
  it('should report the page alone when the renderer was swapped, leaving the calibration out', () => {
    // Given, the counter went down, which is what a new renderer process looks like. The 1.12 s
    // is the throttle calibration, which is deliberate busy work and is not the page's.
    const before = counters({ taskSeconds: 1.116953, scriptSeconds: 0.9 });
    const after = counters({ taskSeconds: 0.174127, scriptSeconds: 0.033222 });

    // When
    const work = mainThreadWorkOf(before, after);

    // Then
    expect(work.rendererReused).toBe(false);
    expect(work.taskMs).toBeCloseTo(174.127, 3);
    expect(work.scriptMs).toBeCloseTo(33.222, 3);
  });

  it('should report the difference when the renderer was reused', () => {
    // Given, the counter went up, so this renderer counted through the navigation
    const before = counters({ taskSeconds: 1.0, layoutSeconds: 0.2 });
    const after = counters({ taskSeconds: 1.25, layoutSeconds: 0.23 });

    // When
    const work = mainThreadWorkOf(before, after);

    // Then
    expect(work.rendererReused).toBe(true);
    expect(work.taskMs).toBeCloseTo(250, 6);
    expect(work.layoutMs).toBeCloseTo(30, 6);
  });

  it('should take every field the same way, so the five never describe two page loads', () => {
    // Given, a swap where one field happens to have risen anyway. Deciding per field would read
    // `scriptSeconds` as a difference and `taskSeconds` as a reset, and the script figure would
    // then be a fragment of a page load the task figure describes whole.
    const before = counters({ taskSeconds: 1.2, scriptSeconds: 0.001 });
    const after = counters({ taskSeconds: 0.3, scriptSeconds: 0.05 });

    // When
    const work = mainThreadWorkOf(before, after);

    // Then
    expect(work.rendererReused).toBe(false);
    expect(work.scriptMs).toBeCloseTo(50, 6);
  });
});

describe('parsedBytesOf', () => {
  it('should split the stylesheets from the bundle by extension, digest names included', () => {
    // Given, the names assets are actually served under
    const resources = [
      resource('http://host/docs/_assets/tokens.9a20c9269c6c9849.css', 'link', 8_000),
      resource('http://host/docs/_assets/theme.b961135c8784bbe3.css', 'link', 19_000),
      resource('http://host/docs/_assets/openref.4877cbbc0d1f011e.js', 'script', 108_000),
    ];

    // When
    const split = parsedBytesOf(29_000, resources);

    // Then
    expect(split).toEqual({
      documentBytes: 29_000,
      cssBytes: 27_000,
      jsBytes: 108_000,
      otherBytes: 0,
    });
  });

  it('should not count a preloaded font as a stylesheet', () => {
    // Given, a face fetched by a `link` rather than by the stylesheet that names it. Classifying
    // on the initiator alone would put 45 KB the main thread never parses as source into the CSS
    // column, which is the one this budget is about.
    const resources = [
      resource('http://host/docs/_assets/tokens.abc.css', 'link', 8_000),
      resource('http://host/docs/_assets/SpaceGrotesk-400-latin.def.woff2', 'link', 45_000),
    ];

    // When
    const split = parsedBytesOf(0, resources);

    // Then
    expect(split.cssBytes).toBe(8_000);
    expect(split.otherBytes).toBe(45_000);
  });

  it('should fall back to the initiator only when the path carries no extension at all', () => {
    // Given, the navigation payload T012-R2 serves has no extension by design
    const resources = [
      resource('http://host/docs/_navigation/abc123', 'fetch', 4_000),
      resource('http://host/docs/_assets/inline-module', 'script', 2_000),
    ];

    // When
    const split = parsedBytesOf(0, resources);

    // Then
    expect(split.jsBytes).toBe(2_000);
    expect(split.otherBytes).toBe(4_000);
  });

  it('should put every byte in exactly one column, so nothing the page fetched is dropped', () => {
    // Given, one of each kind plus something neither rule names
    const resources = [
      resource('http://host/a.css', 'link', 1),
      resource('http://host/b.mjs', 'script', 2),
      resource('http://host/c.woff2', 'css', 4),
      resource('http://host/favicon.ico', 'other', 8),
    ];

    // When
    const split = parsedBytesOf(16, resources);

    // Then
    expect(split.cssBytes + split.jsBytes + split.otherBytes).toBe(15);
    expect(split.documentBytes).toBe(16);
  });

  it('should read a path that is not a url rather than dropping the resource', () => {
    // Given, `new URL` throws on this and a resource lost to a throw would be bytes the reader
    // pays for and the study does not report
    const resources = [resource('not a url at all.css', 'link', 512)];

    // When
    const split = parsedBytesOf(0, resources);

    // Then
    expect(split.cssBytes).toBe(512);
  });
});
