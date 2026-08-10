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

import { RUNNER_KEY, type IRunnerPort } from '@openref/vue';
import { createSSRApp } from 'vue';
import { APP_ROOT_ID, ReferenceApp } from '../components/ReferenceApp';
import { DEFERRABLE_KEY } from '../components/deferrable';
import { deferredComponents } from './deferred';
import { navigationHref } from '../page/domain/links';
import { readNavigationPayload, type NavigationLoader } from '../page/domain/nav-source';
import { STATE_ELEMENT_ID } from '../page/domain/shell';
import type { PageModel } from '../page/domain/page-model';

/** What `hydrateReference` needs to find its way around a document. */
export interface HydrateOptions {
  /** Document to hydrate in. Defaults to the global one. */
  readonly document?: Document;
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
   */
  readonly loadRunner?: () => Promise<IRunnerPort>;
  /**
   * How the rest of the navigation is fetched, for a host that serves it from elsewhere.
   *
   * The default asks this page's own origin at the path `links.ts` names, which is the route
   * `@openref/nest` registers and the file a static build writes. A host that mounts the
   * reference behind a rewrite supplies its own rather than being told to match a path.
   */
  readonly loadNavigation?: NavigationLoader;
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
export function readPageState(root: Document): PageModel | null {
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
  const app = createSSRApp(ReferenceApp, {
    page,
    basePath,
    loadNavigation: options.loadNavigation ?? fetchNavigation(page, basePath),
  });

  // THE CLIENT FILLS THE REGISTRY WITH GATES AND THE SERVER FILLS IT WITH COMPONENTS. Nothing
  // here imports the three implementations, which is what keeps them out of the first chunk;
  // `client-bundle.spec.ts` reads the built file for the proof rather than trusting the shape.
  app.provide(
    DEFERRABLE_KEY,
    deferredComponents({
      document: root,
      ...(options.loadRunner === undefined ? {} : { loadRunner: options.loadRunner }),
      provideRunner: (runner) => {
        app.provide(RUNNER_KEY, runner);
      },
    }),
  );

  if (options.runner !== undefined) app.provide(RUNNER_KEY, options.runner);
  app.mount(mount);

  return true;
}

export { APP_ROOT_ID, ReferenceApp, STATE_ELEMENT_ID };
export type { PageModel };
