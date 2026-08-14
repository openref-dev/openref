/**
 * One entry of the navigation tree.
 *
 * THE SHAPE MOVED TO `@openref/vue` IN `TX-SLOTWIRE`, because `NavTree` is a slot and its props
 * are declared in terms of it, and the headless layer may not import the renderer. This module
 * stays as the name the slice and the rows import, which is the reason it was a module of its
 * own: the page model builds it, the slice cuts it and the rows flatten it, and while the type
 * lived in the model the slice had to import the model that imports the slice. A type only cycle
 * typechecks and is still a cycle.
 */

export type { NavEntryModel } from '@openref/vue';
