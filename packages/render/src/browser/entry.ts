/**
 * Entry of the browser bundle: the one file with a side effect.
 *
 * It is separate from `browser/index.ts` so that importing the client API never hydrates
 * anything by accident, and so that the bundle a page loads with `script type=module` does
 * hydrate without the page needing an inline script to call it. An inline call would need
 * a nonce and would be the only script content on the page, which is precisely the shape
 * SPEC 19.2 rules out.
 */

import { hydrateReference } from './index';

hydrateReference();

export { hydrateReference, readPageState } from './index';
