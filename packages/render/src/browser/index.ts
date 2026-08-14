/**
 * The client half: read the state the server wrote, hydrate, stop.
 *
 * What is NOT here is the point of the file. No markdown parser, no sanitizer, no
 * highlighter, no IR: descriptions arrive as HTML the server already sanitized and code
 * arrives already tokenized, which is what keeps SPEC 12's promise that the highlighter
 * never reaches the browser.
 *
 * NOTHING HERE FETCHES ANYTHING ON LOAD. The state is in the document, per SPEC 19.4. Since
 * T012-R2 that state is the navigation this page can draw rather than the document's whole
 * index, and the rest is fetched from the reader's own origin the first time a reader opens a
 * closed group or the palette. The boundary is the one SPEC 14.4.1 draws: a page that was
 * opened and not touched makes no request beyond loading itself.
 */

import {
  provideSlots,
  resolveSlots,
  RUNNER_KEY,
  type IRunnerPort,
  type ThemeDefinition,
} from '@openref/vue';
import { createSSRApp, h } from 'vue';
import { APP_ROOT_ID, ReferenceApp } from '../components/ReferenceApp';
import { DEFERRABLE_KEY } from '../components/deferrable';
import { deferredComponents } from './deferred';
import { navigationHref } from '../page/domain/links';
import { readNavigationPayload, type NavigationLoader } from '../page/domain/nav-source';
import { STATE_ELEMENT_ID } from '../page/domain/shell';
import type { PageModel } from '../page/domain/page-model';

/**
 * The tree hydration works in: a document, or since T033 a shadow root.
 *
 * STRUCTURAL, AND EXACTLY THE FOUR MEMBERS THE CLIENT USES. `Document` and `ShadowRoot` both
 * carry them, which is what lets the web component hand its own root over without this module
 * knowing which DOM mode the element chose: the state lookup, the mount lookup and the
 * deferral gates all ask the root and never the global document.
 */
export type HydrateRoot = Pick<
  Document,
  'getElementById' | 'querySelector' | 'addEventListener' | 'removeEventListener'
>;

/** What `hydrateReference` needs to find its way around a document. */
export interface HydrateOptions {
  /** Tree to hydrate in: the global document by default, or a web component's shadow root. */
  readonly document?: HydrateRoot;
  /** Where the reference is mounted, so client rendered links match the server's. */
  readonly basePath?: string;
  /**
   * The request runner the try-it console sends through.
   *
   * Absent leaves the console disabled, which is a supported build rather than a degraded one:
   * a reference that is published read only has nothing to send from. The runner is passed in
   * rather than imported because STANDARDS 3.5 gives this package no edge to `@openref/runner`,
   * so composition happens where both are visible, which is `@openref/nest` and the CLI.
   */
  readonly runner?: IRunnerPort;
  /**
   * The same runner, built only if the console is opened.
   *
   * THIS IS THE SHIPPED PATH AND `runner` IS THE EAGER ONE. A runner handed over as a value has
   * to be constructed before the page hydrates, which puts the whole of `@openref/runner` in the
   * first chunk for a console most readers never open. A function is imported dynamically by
   * whoever supplies it, so the runner travels with the console. `runner` stays for a host that
   * has one already, and for the tests that hand over a fake.
   *
   * IT RECEIVES THE PAGE MODEL, per the T033 amendment, because the factory has to read the
   * facts only the server knew, `proxyPath` first among them, and this function is what holds
   * the model. A factory that ignores the argument is the build with no proxy, unchanged.
   */
  readonly loadRunner?: (model: PageModel) => Promise<IRunnerPort>;
  /**
   * How the rest of the navigation is fetched, for a host that serves it from elsewhere.
   *
   * The default asks this page's own origin at the path `links.ts` names, which is the route
   * `@openref/nest` registers and the file a static build writes. A host that mounts the
   * reference behind a rewrite supplies its own rather than being told to match a path.
   */
  readonly loadNavigation?: NavigationLoader;
  /**
   * The theme in force, whose slot overrides this page resolves.
   *
   * IT HAS TO BE THE SAME THEME THE SERVER RENDERED WITH. A position drawn by an override on the
   * server and by the reference's own component here is a hydration mismatch, which is silent and
   * which is why the two halves are named as one decision rather than as two options.
   */
  readonly theme?: ThemeDefinition;
}

/**
 * The default loader: one request, to this page's own origin.
 *
 * SAME ORIGIN BY CONSTRUCTION, not by policy. The path is relative and is built from the
 * document hash the page already carries, so there is nowhere for a host name to enter, and
 * SPEC 19.4 holds whatever a host mounts the reference under.
 *
 * @param page - The page model, for the document hash
 * @param basePath - Where the reference is mounted
 * @returns A loader
 */
function fetchNavigation(page: PageModel, basePath: string): NavigationLoader {
  return async () => {
    const response = await fetch(navigationHref(page.documentHash, basePath), {
      headers: { accept: 'application/json' },
      credentials: 'same-origin',
    });

    if (!response.ok) {
      throw new Error(`the navigation payload answered ${String(response.status)}`);
    }

    return readNavigationPayload(await response.json(), page.documentHash);
  };
}

/**
 * Reads the page model out of the state element.
 *
 * Returns null rather than throwing when the element is missing or unparseable. A page
 * whose state block was stripped by a proxy still shows the server rendered markup, and
 * turning that into an exception would replace a working static page with a blank one.
 *
 * @param root - Document to read from
 * @returns The page model, or null when there is none to read
 */
export function readPageState(root: HydrateRoot): PageModel | null {
  const element = root.getElementById(STATE_ELEMENT_ID);
  if (element === null) return null;

  // An element's textContent is a string, never null; only a document or a doctype gives
  // null, and getElementById returns neither.
  const text = element.textContent;
  if (text.trim() === '') return null;

  try {
    return JSON.parse(text) as PageModel;
  } catch {
    return null;
  }
}

/**
 * Hydrates the server rendered markup.
 *
 * @param options - Document and mount point
 * @returns True when the application was hydrated, false when there was nothing to hydrate
 */
export function hydrateReference(options: HydrateOptions = {}): boolean {
  const root = options.document ?? globalThis.document;
  const mount = root.getElementById(APP_ROOT_ID);
  if (mount === null) return false;

  const page = readPageState(root);
  if (page === null) return false;

  // THE PAGE'S OWN MOUNT POINT IS THE DEFAULT, not the root. A host that mounts the reference
  // at `/docs` serves links under `/docs`, and a client that assumed the root would build every
  // link it rendered, and every request it made, against a path that is not there.
  const basePath = options.basePath ?? page.basePath;
  // THE REGISTRY AND NOT THE WHOLE THEME, per `resolveSlots`: the client draws from the slots and
  // the tokens are the stylesheet's business, so the validation and its sentences stay on the
  // server. The same rule resolves `layout` into `AppShell` on both sides, which is what keeps
  // the frame from being a hydration mismatch.
  const slots = resolveSlots(options.theme);
  const loadNavigation = options.loadNavigation ?? fetchNavigation(page, basePath);
  const app = createSSRApp({
    name: 'OrefClientRoot',
    setup() {
      provideSlots(slots);

      return () => h(ReferenceApp, { page, basePath, loadNavigation });
    },
  });

  // THE CLIENT FILLS THE REGISTRY WITH GATES AND THE SERVER FILLS IT WITH COMPONENTS. Nothing
  // here imports the three implementations, which is what keeps them out of the first chunk;
  // `client-bundle.spec.ts` reads the built file for the proof rather than trusting the shape.
  // THE MODEL IS BOUND HERE AND THE DEFERRED CONTRACT STAYS ARGLESS. This function is what
  // holds the page, so the factory's argument is closed over rather than threaded through the
  // gate machinery, which has no business knowing what a runner reads.
  const loadRunner = options.loadRunner;
  const buildRunner = loadRunner === undefined ? undefined : () => loadRunner(page);

  app.provide(
    DEFERRABLE_KEY,
    deferredComponents({
      document: root,
      ...(buildRunner === undefined ? {} : { loadRunner: buildRunner }),
      provideRunner: (runner) => {
        app.provide(RUNNER_KEY, runner);
      },
    }),
  );

  if (options.runner !== undefined) app.provide(RUNNER_KEY, options.runner);
  app.mount(mount);

  // THE CHECK IS IN THE FIRST CHUNK AND THE ANSWER IS NOT, AND THE MARKER IS A LITERAL HERE.
  // Importing the constant would put a module and its import glue into the first chunk of every
  // page to save a repetition of eleven characters; `oauth-landing.spec.ts` compares the literal
  // against `OAUTH_MARKER` instead, so the two cannot drift apart in silence. A page load that is not a callback,
  // which is every page load but one per sign in, costs this comparison and nothing else; the
  // module that finishes the exchange arrives with the runner it needs, which is the same
  // decision the console itself is behind.
  if (globalThis.location.search.includes('oref_oauth=1')) {
    void import('../shared/oauth-landing').then(async (landing) =>
      landing.completeSignIn(options.runner, buildRunner),
    );
  }

  return true;
}

export { APP_ROOT_ID, ReferenceApp, STATE_ELEMENT_ID };
export type { PageModel };
// The theme contract type rides along for whoever composes an entry, per T033: a themed entry
// hands `hydrateReference` a definition, and this surface is the one it imports from.
export type { ThemeDefinition };
