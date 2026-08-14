/**
 * The browser entry built with this theme, which is how its components reach a reader.
 *
 * ONE BUNDLE, ONE `@openref/vue` INSTANCE, per the T033 decision. The overrides below travel
 * as code, and code arrives in the entry a page loads, so the entry is built WITH the
 * definition rather than resolving it at runtime: there is one instance because there is one
 * bundle, not because a map says so. A host selects this theme by passing the definition and
 * `@openref/theme-telltale/entry` to the `theme` option, and the server serves this file where
 * it served the default entry.
 *
 * THIS FILE MAY IMPORT `@openref/nest`, AND ONLY THIS FILE IN THIS PACKAGE MAY. The theme
 * itself stays written against `@openref/vue` alone, which is what T032 proved and what the
 * boundary rule still enforces for every module but this one. The entry is not the theme: it
 * is the composition of the theme with the reference client, and composition lives where all
 * the parts are visible, which the dependency rules name as this package's one exception.
 */

import { mountReference } from '@openref/nest/browser-entry';
import telltale from './theme';

mountReference(telltale);
