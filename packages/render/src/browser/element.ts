/**
 * The reference as a custom element, per SPEC 10.3: both DOM modes of the Web Component
 * distribution.
 *
 * WHAT IT EMBEDS IS A SERVED PAGE, NOT A DOCUMENT. The element fetches a page of a reference
 * this same origin already serves, adopts its markup, its state block and its stylesheet
 * links, and hydrates inside its own root. Nothing is normalized, sanitized or highlighted in
 * the browser, which keeps SPEC 12's promise intact inside an embed, and nothing is fetched
 * across an origin, which keeps SPEC 19.4's. A consumer on another origin entirely is served
 * by the static build of M3, whose files are same origin wherever they are hosted; until
 * then the boundary is stated here and in the compatibility table rather than crossed.
 *
 * THE TWO MODES ARE THE SPEC 10.3 TABLE, AND THE DEFAULT IS SHADOW. `shadow` isolates the
 * embedded reference from the host page's stylesheet, which is what an embed inside a portal
 * with its own design usually wants, and costs exactly what the table says: an L2 theme must
 * be self sufficient in styles, and the host page's global CSS does not reach in.
 * `shadow="false"` is the first class light DOM mode: the host's global CSS applies, which is
 * the whole point for a theme that leans on it, and the adopted markup sits in the page like
 * any other markup.
 *
 * FONTS ARE HOISTED IN SHADOW MODE AND THE REASON IS A PLATFORM RULE, NOT A PREFERENCE. A
 * `@font-face` declared inside a shadow root registers no font family; the document is the
 * font registry. So in shadow mode the stylesheet links are adopted into the root, where
 * their rules apply, and are also appended to `document.head`, where their `@font-face`
 * declarations register. The head copies style nothing: every rule in a theme's stylesheets
 * targets `oref-` or theme prefixed classes, and the host page has none, while the shadow
 * boundary keeps them out of the embed. The duplication costs one cached fetch per sheet.
 */

import {
  APP_ROOT_ID,
  hydrateReference,
  STATE_ELEMENT_ID,
  type HydrateOptions,
  type HydrateRoot,
} from './index';
import type { PageModel } from '../page/domain/page-model';
import type { IRunnerPort } from '@openref/vue';
import type { ThemeDefinition } from '@openref/vue';

/** What the element composes into every page it embeds. */
export interface ReferenceElementOptions {
  /**
   * The theme the embedded pages were rendered with, per the pair rule of the T033 amendment:
   * an element compiled without the theme would hydrate a themed page into a silent mismatch,
   * so an embed of a themed reference uses an element built with the same definition.
   */
  readonly theme?: ThemeDefinition;
  /** The runner factory, composed by whoever can see the runner. Absent leaves try-it off. */
  readonly loadRunner?: (model: PageModel) => Promise<IRunnerPort>;
}

/** The tag name the shipped outputs register the element under. */
export const REFERENCE_ELEMENT_TAG = 'openref-reference';

/**
 * A same origin path, or nothing.
 *
 * The one thing an embed must never do is fetch another origin, so the attribute is a path by
 * construction: absolute URLs and scheme relative ones do not pass, the same rule the proxy
 * transport applies to its endpoint.
 *
 * @param href - The attribute as written
 * @returns The path, or null when it is not a path on this origin
 */
function sameOriginPath(href: string | null): string | null {
  if (href === null || !href.startsWith('/') || href.startsWith('//')) return null;
  return href;
}

/**
 * A lookup adapter over the element itself, for light DOM mode.
 *
 * A shadow root carries `getElementById`; an element does not, so the light mode answers the
 * same four questions scoped to the element's subtree. Events bubble to the host, which is
 * where the deferral gates listen.
 *
 * @param host - The element
 * @returns The root hydration works in
 */
function lightRoot(host: HTMLElement): HydrateRoot {
  return {
    getElementById: (elementId: string) => host.querySelector(`#${CSS.escape(elementId)}`),
    querySelector: (selectors: string) => host.querySelector(selectors),
    addEventListener: host.addEventListener.bind(host),
    removeEventListener: host.removeEventListener.bind(host),
  };
}

/**
 * Builds the custom element class, with the composition closed over.
 *
 * A FACTORY RATHER THAN A CLASS, for the same reason the entry is built with the theme: what
 * the element hydrates with is a build time fact. The shipped outputs call this once with the
 * reference's own composition and register the result; an element for a themed reference is
 * the same call with that theme's definition, made by the artefact the theme ships.
 *
 * @param options - Theme and runner composition
 * @returns The element class, ready for `customElements.define`
 */
export function defineReferenceElement(options: ReferenceElementOptions = {}): typeof HTMLElement {
  return class OpenRefReferenceElement extends HTMLElement {
    /** Whether this element already loaded, so reconnection does not fetch twice. */
    private loaded = false;

    connectedCallback(): void {
      if (this.loaded) return;
      this.loaded = true;
      // The failure lands in the element as words either way: a rejection that only a console
      // saw would read as a defect of the host page.
      this.embed().catch((cause: unknown) => {
        this.fail(`the embed failed: ${String(cause)}`);
      });
    }

    /** Fetches the served page and stands it up inside this element's root. */
    private async embed(): Promise<void> {
      const href = sameOriginPath(this.getAttribute('href'));
      const shadow = this.getAttribute('shadow') !== 'false';

      if (href === null) {
        this.fail('openref-reference needs href, a path on this origin, such as /docs');
        return;
      }

      let markup: string;
      try {
        const response = await fetch(href, {
          headers: { accept: 'text/html' },
          credentials: 'same-origin',
        });
        if (!response.ok) {
          this.fail(`the reference at ${href} answered ${String(response.status)}`);
          return;
        }
        markup = await response.text();
      } catch {
        this.fail(`the reference at ${href} could not be fetched`);
        return;
      }

      const page = new DOMParser().parseFromString(markup, 'text/html');
      const app = page.getElementById(APP_ROOT_ID);
      const state = page.getElementById(STATE_ELEMENT_ID);

      if (app === null || state === null) {
        this.fail(`${href} is not a served reference page`);
        return;
      }

      const root: ShadowRoot | HTMLElement = shadow ? this.attachShadow({ mode: 'open' }) : this;

      // The stylesheet links of the served page, adopted into the root so the embed is styled
      // the way the page was. In shadow mode the same links go to the document head as well,
      // per the font registry rule in the file comment.
      for (const link of Array.from(page.querySelectorAll('link[rel="stylesheet"]'))) {
        root.append(link.cloneNode());
        if (shadow) hoistForFonts(link, this.ownerDocument);
      }

      root.append(state.cloneNode(true));
      root.append(app.cloneNode(true));

      const within: HydrateRoot = shadow ? (root as ShadowRoot) : lightRoot(this);
      const hydration: HydrateOptions = {
        document: within,
        ...(options.theme === undefined ? {} : { theme: options.theme }),
        ...(options.loadRunner === undefined ? {} : { loadRunner: options.loadRunner }),
      };

      if (!hydrateReference(hydration)) {
        this.fail(`${href} carried no state this element could hydrate`);
        return;
      }

      // The element's own done signal, for a host page that styles or waits by state, and for
      // every test that would otherwise poke at the framework's private markers.
      this.setAttribute('data-oref-embedded', '');
    }

    /**
     * Puts the failure where the embed would have been, in words.
     *
     * A refused embed that rendered nothing would read as a defect of the host page; a
     * sentence in the element names whose defect it is and what to change.
     */
    private fail(reason: string): void {
      const notice = this.ownerDocument.createElement('p');
      notice.className = 'oref-embed-error';
      notice.textContent = reason;
      this.replaceChildren(notice);
    }
  };
}

/**
 * Appends a copy of a stylesheet link to the document head, once per href.
 *
 * @param link - The link as the served page wrote it
 * @param target - The embedding document
 */
function hoistForFonts(link: Element, target: Document): void {
  const href = link.getAttribute('href') ?? '';
  const marker = `link[data-oref-embed-fonts="${CSS.escape(href)}"]`;
  if (href === '' || target.head.querySelector(marker) !== null) return;

  const copy = link.cloneNode() as Element;
  copy.setAttribute('data-oref-embed-fonts', href);
  target.head.append(copy);
}
