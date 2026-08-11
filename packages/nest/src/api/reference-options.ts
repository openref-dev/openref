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

import type { AssetPlan } from '../assets/infrastructure/adapters/package-assets.adapter';
import type { ErrorReporter } from '../http/domain/reply';
import type { NonceReader } from '../http/infrastructure/adapters/express-reference.adapter';
import type { IRenderCache } from '@openref/render';

/** Everything `setup` accepts. Only `document` is required, per SPEC 13.1. */
export interface OpenRefSetupOptions {
  /** The OpenAPI document, as the object `SwaggerModule.createDocument` returns, or as text. */
  readonly document: unknown;
  /**
   * Stylesheets the page links, as package specifiers or absolute paths.
   *
   * Defaults to the three files of `@openref/theme`. A host that ships its own theme passes
   * its own list and the default theme is never read.
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
}
