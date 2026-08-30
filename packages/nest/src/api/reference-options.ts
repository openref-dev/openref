/**
 * Options shared by both entry points of SPEC 13.
 *
 * IN A FILE OF THEIR OWN BECAUSE BOTH SIDES NEED THEM AND NEITHER MAY IMPORT THE OTHER.
 * `api/openref.module.ts` declares `setup` and `forRoot`, `api/module-options.ts` declares what
 * `forRoot` accepts, and an entry of `documents` is these options plus an id and a route. Left in
 * the module file, the two would import each other, and the `no-circular` rule of the dependency
 * gate reads a type-only cycle as a cycle, correctly: a cycle that is erased at runtime is still
 * a cycle in the source, and the next thing added to it may not be a type.
 */

import type { ErrorReporter } from '../http/domain/reply';
import type { NonceReader } from '../http/infrastructure/adapters/express-reference.adapter';
import type {
  OpenRefThemeOptions,
  ProxyOptions,
} from '../reference/application/services/reference.service';
import type { OpenRefVisibilityOptions } from '../visibility/domain/visibility';
import type { AssetPlan, IRenderCache } from '@openref/render';

/**
 * Everything `setup` accepts apart from the visibility pair, which arrives beside it.
 *
 * SPLIT OUT OF `OpenRefSetupOptions` AT `T056`, when that type stopped being an interface. SPEC
 * 14.8 bans a bridge under public visibility at the type level, the ban is two arms of a union,
 * and an interface cannot extend one; the members that do not take part in the ban stay here, in
 * one place, so no arm can gain an option the other quietly lacks.
 */
export interface OpenRefSetupBaseOptions {
  /** The OpenAPI document, as the object `SwaggerModule.createDocument` returns, or as text. */
  readonly document: unknown;
  /**
   * The theme in force, per SPEC 10.4: the definition and, when it carries components, the
   * browser entry built with them. See `OpenRefThemeOptions` for the pair rule.
   *
   * Its `assets.css` becomes the stylesheet list and its `bundle` the client bundle, each
   * unless the narrower option below overrides it, so a theme package is one import and one
   * option rather than three lists kept equal by hand.
   */
  readonly theme?: OpenRefThemeOptions;
  /**
   * Stylesheets the page links, as package specifiers or absolute paths.
   *
   * Defaults to the theme's `assets.css` when a theme is set, and to the three files of
   * `@openref/theme` otherwise. A host that passes its own list overrides both.
   */
  readonly stylesheets?: readonly string[];
  /** Client bundle, as a package specifier or an absolute path. Defaults to this package's. */
  readonly clientBundle?: string;
  /**
   * The assets as bytes, for a host that already has them.
   *
   * Supplied, nothing is read from disk and `stylesheets` and `clientBundle` are ignored. It
   * is what a build that produces its own assets uses, and what lets the route table be
   * tested without a theme package or a build being present.
   */
  readonly assetPlan?: AssetPlan;
  /** Render cache, defaulting to the bounded in memory one of SPEC 12. */
  readonly cache?: IRenderCache;
  /** Syntax highlighting on the server. On by default. */
  readonly highlight?: boolean;
  /** Value of the `lang` attribute on the rendered document. */
  readonly lang?: string;
  /** Forces a colour scheme instead of following the reader's system preference. */
  readonly colorScheme?: 'light' | 'dark';
  /**
   * Where the CSP nonce for a response is found.
   *
   * Tried before the two conventions a helmet integration leaves one under,
   * `res.locals.cspNonce` on Express and `reply.cspNonce.script` on Fastify. THIS PACKAGE
   * SENDS NO POLICY HEADER OF ITS OWN: a policy belongs to the application, and one written
   * here would have to guess `connect-src`, which is what the try-it console sends through.
   */
  readonly nonce?: NonceReader;
  /** Where an unexpected failure inside a documentation route is reported. */
  readonly onError?: ErrorReporter;
  /**
   * The same origin proxy of SPEC 14.5, off unless this says otherwise.
   *
   * OFF IS THE DEFAULT BECAUSE THE PROXY IS THE ONE PART OF THIS PACKAGE THAT SENDS A REQUEST
   * SOMEWHERE. A documentation server that will send a request on a reader's behalf can reach
   * whatever it can reach, so turning it on is a sentence a host writes rather than a state they
   * arrive in. The route exists either way and answers 403 while it is off, so the two states are
   * distinguishable from outside.
   */
  readonly proxy?: ProxyOptions;
}

/**
 * Everything `setup` accepts. Only `document` is required, per SPEC 13.1.
 *
 * IT CARRIES THE VISIBILITY PAIR SINCE `TX-VIS`, AND THAT IS WHERE BOTH ENTRY POINTS GET IT. An
 * entry of `documents` is these options plus an id and a route, so declaring `visibility` and
 * `guard` in one place puts them on both forms at once and makes it impossible for one of the two
 * to gain a security option the other quietly lacks. SPEC 13.2 records why `setup` needs them at
 * all, and since `T056` the pair carries the bridge of SPEC 14.8 with it, for the same reason: the
 * bridge is banned by the visibility, so the two travel as one.
 */
export type OpenRefSetupOptions = WithSetupBase<OpenRefVisibilityOptions>;

/**
 * Puts the base options on each arm of a visibility union.
 *
 * IT DISTRIBUTES, WHICH IS THE WHOLE OF WHY IT EXISTS. Written as a plain intersection,
 * `Base & (Public | Closed)` is one intersection whose `keyof` collapses the two arms, and the
 * ban goes with it: `bridge` becomes assignable again because the compiler no longer has two
 * shapes to choose between. A conditional over a naked type parameter distributes, so what comes
 * out is a real union of two object types and the discrimination survives every later `Omit`.
 */
type WithSetupBase<T> = T extends unknown ? T & OpenRefSetupBaseOptions : never;
