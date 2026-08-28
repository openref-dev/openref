/**
 * Who a mounted reference is for, and what enforces it.
 *
 * THE PAIR TRAVELS TOGETHER AND IS DECLARED ONCE, because both entry points of SPEC 13 carry it:
 * an entry of `documents` and the options `setup` takes are the same two fields, per the SPEC 13.2
 * note added with `TX-VIS`. A host whose document comes from `SwaggerModule` cannot use `forRoot`
 * to mount it at all, so a visibility that existed only on `documents` would be a reference that
 * the ordinary NestJS application is unable to close.
 */

import type { GuardLike } from '../../shared/types/nest-surface';

/**
 * Who the reference is for, per SPEC 13.2 and `@ApiAudience`.
 *
 * A LITERAL UNION SO AN UNHONOURED VALUE CANNOT BE PASSED AT ALL, which is the same move T014 made
 * when it kept this out of the browser entry. The three names are the audience of `@ApiAudience`,
 * and the difference between the two non public ones is documentation rather than mechanism: both
 * mean "not everyone", and what separates one deployment from another is the guard, which is the
 * host's and not this package's.
 */
export type OpenRefVisibility = 'public' | 'partner' | 'internal';

/** Every value {@link OpenRefVisibility} allows, as data, so a value off the type is refused. */
export const VISIBILITIES: readonly OpenRefVisibility[] = ['public', 'partner', 'internal'];

/**
 * The default, and it is a decision rather than an absent parameter.
 *
 * PUBLIC, AND SPEC 19.6 RECORDS WHY. SPEC 13.1 is one line with no guard in it and SPEC 2's first
 * minute is built on that line, so a default of "closed" would make the documented starting point
 * of this package fail to serve anything. Closed is what a host writes, not what a host arrives in;
 * the strictness lives one step further on, where a non public visibility with no guard is refused
 * at boot rather than served.
 */
export const DEFAULT_VISIBILITY: OpenRefVisibility = 'public';

/** The two fields both entry points of SPEC 13 carry. */
export interface OpenRefVisibilityOptions {
  /**
   * Who this reference is for. Defaults to {@link DEFAULT_VISIBILITY}.
   *
   * Anything other than `public` requires {@link OpenRefVisibilityOptions.guard}, per SPEC 19.6.
   */
  readonly visibility?: OpenRefVisibility;
  /**
   * The guard every route of this mount runs behind, per SPEC 13.2 and 19.6.
   *
   * A CLASS THE CONTAINER KNOWS, OR AN INSTANCE. A class is resolved out of the container once, at
   * mount, and a class the container does not know is refused there rather than constructed here:
   * a guard built with unresolved dependencies answers something nobody can predict, and on this
   * side of the question the unpredictable answer is "open".
   *
   * A LIST IS A CONJUNCTION, exactly as `@UseGuards` is: every one of them has to admit. An empty
   * list is refused, because it reads as guarded and is not.
   */
  readonly guard?: GuardLike | readonly GuardLike[];
}
