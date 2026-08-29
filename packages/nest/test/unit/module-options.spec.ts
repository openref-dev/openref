import { describe, expect, it } from 'vitest';
import { assertRootOptions } from '../../src/api/module-options';
import type { OpenRefRootOptions } from '../../src/api/module-options';
import { specification } from '../mocks/fixtures';

/**
 * What `forRoot` refuses, which is the part of an option surface that is worth testing.
 *
 * EVERY CASE BELOW IS AN OPTION THAT WOULD OTHERWISE DO NOTHING QUIETLY. SPEC 13.2 prints the
 * whole form across every milestone, so a host reading the specification can write `runner` or
 * `federation` today, and the only honest answer until those milestones is an error naming the
 * one that owns it. `visibility` is the sharpest of them: accepted and ignored, it would serve a
 * reference to everyone while the host believed it had made it private.
 */

function options(partial: Partial<OpenRefRootOptions> = {}): OpenRefRootOptions {
  return {
    documents: [{ id: 'public', route: '/docs', document: specification() }],
    ...partial,
  };
}

describe('assertRootOptions', () => {
  it('should accept a forRoot carrying only runtime, which is the ordinary shape', () => {
    // Given, a document from SwaggerModule does not exist when forRoot is read, so the host
    // registers the pass here and calls setup once it does
    const withoutDocuments: OpenRefRootOptions = { runtime: { collectors: [] } };

    // When, Then
    expect(() => {
      assertRootOptions(withoutDocuments);
    }).not.toThrow();
  });

  it('should accept a document entry with an id and a route', () => {
    // When, Then
    expect(() => {
      assertRootOptions(options());
    }).not.toThrow();
  });

  it('should refuse a document with no id, because federation and the CLI address it by one', () => {
    // Given
    const bad = { documents: [{ route: '/docs', document: {} }] } as unknown as OpenRefRootOptions;

    // When, Then
    expect(() => {
      assertRootOptions(bad);
    }).toThrow(/non empty id/);
  });

  it('should refuse two documents sharing an id', () => {
    // Given
    const bad = options({
      documents: [
        { id: 'public', route: '/docs', document: {} },
        { id: 'public', route: '/other', document: {} },
      ],
    });

    // When, Then
    expect(() => {
      assertRootOptions(bad);
    }).toThrow(/share the id "public"/);
  });

  it('should refuse two documents on one route, since the second would never be reached', () => {
    // Given
    const bad = options({
      documents: [
        { id: 'a', route: '/docs', document: {} },
        { id: 'b', route: '/docs', document: {} },
      ],
    });

    // When, Then
    expect(() => {
      assertRootOptions(bad);
    }).toThrow(/mounted on "\/docs"/);
  });

  it('should refuse a non public visibility that supplies no guard, before the container', () => {
    // Given, SPEC 19.6: a document that asks to be private and names nothing to enforce it would
    // be served to everyone while the host read no error at all
    const bad = options({
      documents: [{ id: 'admin', route: '/docs', document: {}, visibility: 'internal' }],
    });

    // When, Then
    expect(() => {
      assertRootOptions(bad);
    }).toThrow(/supplies no guard/);
  });

  it('should accept a non public visibility once a guard stands behind it', () => {
    // Given
    const good = options({
      documents: [
        {
          id: 'admin',
          route: '/docs',
          document: {},
          visibility: 'internal',
          guard: { canActivate: (): boolean => true },
        },
      ],
    });

    // When, Then
    expect(() => {
      assertRootOptions(good);
    }).not.toThrow();
  });

  it('should accept the visibility it can honour', () => {
    // Given
    const good = options({
      documents: [{ id: 'public', route: '/docs', document: {}, visibility: 'public' }],
    });

    // When, Then
    expect(() => {
      assertRootOptions(good);
    }).not.toThrow();
  });

  for (const [key, milestone] of Object.entries({
    runner: /T034 reconciles/,
    agent: /M6, T058/,
    devWatch: /M3/,
  })) {
    it(`should refuse the ${key} option of SPEC 13.2 and say which milestone owns it`, () => {
      // Given
      const bad: OpenRefRootOptions = { ...options(), [key]: {} };

      // When, Then
      expect(() => {
        assertRootOptions(bad);
      }).toThrow(milestone);
    });
  }

  it('should accept a federation of remotes, which left NOT_YET_BUILT at T046', () => {
    // Given, the SPEC 15 form: remotes to poll, mounted on a route of its own
    const good = options({
      federation: {
        route: '/federated',
        id: 'gateway',
        remotes: [{ id: 'billing', url: 'https://billing.example/openapi.json' }],
      },
    });

    // When, Then
    expect(() => {
      assertRootOptions(good);
    }).not.toThrow();
  });

  it('should refuse a federation with nothing to merge', () => {
    // Given, no remotes and no local services
    const bad = options({ federation: { route: '/federated', id: 'gateway' } });

    // When, Then
    expect(() => {
      assertRootOptions(bad);
    }).toThrow(/nothing to merge/);
  });

  it('should refuse a federation naming a local service no documents entry carries', () => {
    // Given, a local service is a documents entry of this same forRoot, per SPEC 15.3
    const bad = options({
      federation: { route: '/federated', id: 'gateway', services: [{ id: 'billing' }] },
    });

    // When, Then
    expect(() => {
      assertRootOptions(bad);
    }).toThrow(/no documents entry carries that id/);
  });

  it('should refuse a federation mounted on a route a document claims', () => {
    // Given
    const bad = options({
      documents: [{ id: 'public', route: '/docs', document: {} }],
      federation: {
        route: '/docs',
        id: 'gateway',
        remotes: [{ id: 'billing', url: 'https://billing.example/openapi.json' }],
      },
    });

    // When, Then
    expect(() => {
      assertRootOptions(bad);
    }).toThrow(/both mounted on/);
  });

  it('should accept the theme option, which left NOT_YET_BUILT at T033', () => {
    // Given, the root level default of SPEC 13.2, an L0 definition that needs no bundle
    const good: OpenRefRootOptions = {
      ...options(),
      theme: { definition: { name: 'l0', tokens: { '--oref-color-accent': '#08f' } } },
    };

    // When, Then
    expect(() => {
      assertRootOptions(good);
    }).not.toThrow();
  });

  it('should refuse a global cache and point at the per document one that exists', () => {
    // Given, `cache` is real and it is an entry of `documents`, not a root option
    const bad = { ...options(), cache: {} } as OpenRefRootOptions;

    // When, Then
    expect(() => {
      assertRootOptions(bad);
    }).toThrow(/pass it in a documents entry/);
  });

  it('should accept a guard to scheme mapping, which SPEC 7.1 leaves to the host', () => {
    // Given
    const good: OpenRefRootOptions = {
      ...options(),
      runtime: { guardSecuritySchemes: { JwtAuthGuard: 'bearer' } },
    };

    // When, Then
    expect(() => {
      assertRootOptions(good);
    }).not.toThrow();
  });

  it('should refuse a guard mapped to an empty scheme name rather than compare against it', () => {
    // Given, an empty name reads as "this guard stands for nothing", which is what leaving the
    // guard out of the map already says, and `security-drift` would report every operation
    const bad: OpenRefRootOptions = {
      ...options(),
      runtime: { guardSecuritySchemes: { JwtAuthGuard: '' } },
    };

    // When, Then
    expect(() => {
      assertRootOptions(bad);
    }).toThrow(/empty security scheme name/);
  });
});
