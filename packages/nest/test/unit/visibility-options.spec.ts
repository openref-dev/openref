import { describe, expect, it, vi } from 'vitest';
import { InvalidOptionsError } from '@openref/core';
import {
  admissionFor,
  assertVisibility,
} from '../../src/visibility/application/services/admission.service';
import { DEFAULT_VISIBILITY } from '../../src/visibility/domain/visibility';
import type { OpenRefVisibilityOptions } from '../../src/visibility/domain/visibility';
import type { CanActivateLike } from '../../src/shared/types/nest-surface';

/**
 * The half of SPEC 19.6 that happens before a request exists: what a host may write, and what is
 * refused while the application is still booting.
 *
 * EVERY REFUSAL HERE IS A BOOT FAILURE RATHER THAN A WARNING, and the reason is the same one in
 * every case. The state each of these describes is a host that believes the reference is closed
 * while it is open, and a boot log is a thing that gets scrolled past.
 */

/** A guard that admits, as an instance rather than a class. */
const admits: CanActivateLike = { canActivate: (): boolean => true };

/** A resolver that knows nothing, which is what a container answers for an unregistered class. */
function unknownToContainer(): (token: unknown) => unknown {
  return (token: unknown): unknown => {
    throw new Error(`Nest could not find ${String(token)}`);
  };
}

describe('the default visibility', () => {
  it('should be public, and a mount that says nothing should guard nothing', () => {
    // Given, SPEC 19.6 records the reasoning: SPEC 13.1 is one line with no guard in it, so a
    // default of closed would make the documented starting point of this package serve nothing
    const options: OpenRefVisibilityOptions = {};

    // When
    const admission = admissionFor('the reference', options, unknownToContainer());

    // Then
    expect(DEFAULT_VISIBILITY).toBe('public');
    expect(admission.guarded).toBe(false);
    expect(() => {
      assertVisibility('the reference', options);
    }).not.toThrow();
  });

  it('should behave the same whether public was written or left out', () => {
    // Given
    const written = admissionFor('a', { visibility: 'public' }, unknownToContainer());
    const omitted = admissionFor('b', {}, unknownToContainer());

    // Then
    expect([written.guarded, omitted.guarded]).toEqual([false, false]);
  });
});

describe('assertVisibility', () => {
  it('should refuse a non public visibility with no guard, naming the mount', () => {
    // Given
    const act = (): void => {
      assertVisibility('the document "admin"', { visibility: 'internal' });
    };

    // Then
    expect(act).toThrow(InvalidOptionsError);
    expect(act).toThrow(/the document "admin"/);
    expect(act).toThrow(/supplies no guard/);
  });

  it('should refuse partner as firmly as internal, since both mean not everyone', () => {
    // Given
    const act = (): void => {
      assertVisibility('the reference', { visibility: 'partner' });
    };

    // Then
    expect(act).toThrow(/supplies no guard/);
  });

  it('should refuse a visibility outside the three names rather than reading it as closed', () => {
    // Given, a host with no types can write anything, and a misspelled audience deciding who may
    // read the reference is the wrong way for a typo to be resolved
    const act = (): void => {
      assertVisibility('the reference', {
        visibility: 'privat',
      } as unknown as OpenRefVisibilityOptions);
    };

    // Then
    expect(act).toThrow(/not one of public, partner, internal/);
  });

  it('should refuse an empty guard list, which reads as protected and protects nothing', () => {
    // Given
    const act = (): void => {
      assertVisibility('the reference', { visibility: 'internal', guard: [] });
    };

    // Then
    expect(act).toThrow(/empty list/);
  });

  it('should accept a non public visibility once a guard stands behind it', () => {
    // Given
    const act = (): void => {
      assertVisibility('the reference', { visibility: 'internal', guard: admits });
    };

    // Then
    expect(act).not.toThrow();
  });
});

describe('admissionFor', () => {
  it('should use a guard instance as it is, without asking the container', () => {
    // Given
    const resolve = vi.fn();

    // When
    const admission = admissionFor(
      'the reference',
      { visibility: 'internal', guard: admits },
      resolve,
    );

    // Then
    expect(admission.guarded).toBe(true);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('should resolve a guard class out of the container', () => {
    // Given, SPEC 13.2 writes the class, which is what `@UseGuards` takes
    class AdminDocsGuard {
      canActivate(): boolean {
        return true;
      }
    }
    const instance = new AdminDocsGuard();
    const resolve = vi.fn(() => instance);

    // When
    const admission = admissionFor(
      'the reference',
      { visibility: 'internal', guard: AdminDocsGuard },
      resolve,
    );

    // Then
    expect(admission.guarded).toBe(true);
    expect(resolve).toHaveBeenCalledWith(AdminDocsGuard);
  });

  it('should refuse a guard class the container does not know, and name it', () => {
    // Given, it is not constructed here: a guard built with unresolved dependencies decides
    // something nobody can predict, and unpredictable on this question means open
    class AdminDocsGuard {
      canActivate(): boolean {
        return true;
      }
    }

    const act = (): unknown =>
      admissionFor('the reference', { visibility: 'internal', guard: AdminDocsGuard }, () => {
        throw new Error('Nest could not find AdminDocsGuard');
      });

    // Then
    expect(act).toThrow(InvalidOptionsError);
    expect(act).toThrow(/AdminDocsGuard/);
    expect(act).toThrow(/Register it as a provider/);
  });

  it('should refuse what the container resolved when it has no canActivate', () => {
    // Given
    class AdminDocsGuard {
      canActivate(): boolean {
        return true;
      }
    }

    const act = (): unknown =>
      admissionFor('the reference', { visibility: 'internal', guard: AdminDocsGuard }, () => ({
        notAGuard: true,
      }));

    // Then
    expect(act).toThrow(/no canActivate method/);
  });

  it('should refuse a guard that is neither a class nor an object with canActivate', () => {
    // Given
    const act = (): unknown =>
      admissionFor(
        'the reference',
        { visibility: 'internal', guard: 'AdminDocsGuard' } as unknown as OpenRefVisibilityOptions,
        unknownToContainer(),
      );

    // Then
    expect(act).toThrow(/neither a class nor an object with canActivate/);
  });

  it('should run a guard a public reference declared, rather than dropping it', () => {
    // Given, a security option accepted and ignored is the same defect as a visibility accepted
    // and unenforced, written the other way round
    const options: OpenRefVisibilityOptions = { visibility: 'public', guard: admits };

    // When
    const admission = admissionFor('the reference', options, unknownToContainer());

    // Then
    expect(admission.guarded).toBe(true);
  });

  it('should keep every guard of a list, in the order it was written', async () => {
    // Given
    const order: string[] = [];
    const first: CanActivateLike = {
      canActivate: () => {
        order.push('first');
        return true;
      },
    };
    const second: CanActivateLike = {
      canActivate: () => {
        order.push('second');
        return true;
      },
    };

    // When
    const admission = admissionFor(
      'the reference',
      { visibility: 'internal', guard: [first, second] },
      unknownToContainer(),
    );
    await admission.at('get', '/docs')({}, {});

    // Then
    expect(order).toEqual(['first', 'second']);
  });
});
