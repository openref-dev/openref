import { describe, expect, it } from 'vitest';
import {
  IMMUTABLE as NEST_IMMUTABLE,
  NO_STORE as NEST_NO_STORE,
  REVALIDATE as NEST_REVALIDATE,
} from '@openref/nest';
import { IMMUTABLE, NO_STORE, REVALIDATE, nonceOf } from '../../src/runtime/handler';
import { referenceEntrySource, RUNTIME_SPECIFIER } from '../../src/index';
import type { EmbeddedSite } from '../../src/index';

/**
 * The two things the runtime states in its own words, held to the surfaces they must match.
 *
 * THE CACHE VOCABULARY IS SPOKEN BY TWO MOUNTS AND MUST BE ONE VOCABULARY. `@openref/nest` serves
 * the same reference under the same rules, and two mounts answering one document with different
 * cache directives would be one document behaving two ways.
 *
 * THE EDGE THIS FILE USES IS A TEST EDGE, AND THE DISTINCTION IS THE BOUNDARY RULE'S OWN. Every
 * rule in `tools/dependency-rules.cjs` anchors at `^packages/<pkg>/src/`, so `packages/nuxt/src`
 * may not reach `@openref/nest` and this suite may, exactly as `samples` reaches `@openref/vue`
 * from its tests and `action` reaches `openref` from its own. What could not be done is put the
 * three values in one module: `nuxt` may not import `nest` in `src`, `nest` may not import `nuxt`
 * at all, and the `@openref/nest/browser` precedent of a string specifier answers a resolution
 * question rather than a value one, since a string cannot be compared to a constant. So the two
 * spellings stay where they are and this check is what holds them equal, which is the standing
 * rule about a vocabulary spoken by more than one surface.
 */

/** An embedded site with nothing interesting in it, for the shape of the generated entry. */
const EMBEDDED: EmbeddedSite = {
  specification: 'openapi: 3.1.0\n',
  source: '/tmp/openapi.yaml',
  base: '/docs',
  target: null,
  forwardCookies: false,
  lang: null,
  colorScheme: null,
  assets: {
    servedNames: { 'theme.css': 'theme.abc.css' },
    stylesheetNames: [],
    moduleName: 'a.js',
  },
};

describe('the cache vocabulary', () => {
  it('should be the one @openref/nest serves the same reference with', () => {
    // Given
    const nest = [NEST_IMMUTABLE, NEST_REVALIDATE, NEST_NO_STORE];

    // When
    const nuxt = [IMMUTABLE, REVALIDATE, NO_STORE];

    // Then
    expect(nuxt).toEqual(nest);
  });
});

describe('nonceOf', () => {
  it('should read the nonce a host put on the event context', () => {
    // Given
    const context = { cspNonce: 'dGVzdC1ub25jZS0xMjM0' };

    // When
    const nonce = nonceOf(context);

    // Then
    expect(nonce).toBe('dGVzdC1ub25jZS0xMjM0');
  });

  it('should read no nonce from a host that serves no policy, rather than inventing one', () => {
    // Given
    const empty = {};
    const blank = { cspNonce: '' };
    const wrongType = { cspNonce: 42 };

    // Then
    expect(nonceOf(empty)).toBeUndefined();
    expect(nonceOf(blank)).toBeUndefined();
    expect(nonceOf(wrongType)).toBeUndefined();
  });
});

describe('referenceEntrySource', () => {
  it('should generate a call to the compiled runtime and nothing else', () => {
    // When
    const source = referenceEntrySource(EMBEDDED);

    // Then
    expect(source).toContain(`from "${RUNTIME_SPECIFIER}"`);
    expect(source).toContain('createReferenceHandler(');
    expect(source).toContain('"base": "/docs"');
    expect(source.split('\n').filter((line) => line.startsWith('import ')).length).toBe(1);
  });

  it('should carry the specification text itself, so the server needs no file at run time', () => {
    // When
    const source = referenceEntrySource(EMBEDDED);

    // Then
    expect(source).toContain(JSON.stringify(EMBEDDED.specification));
  });
});
