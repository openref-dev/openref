/**
 * The registry that compiles everything up front, which is what a server render needs.
 *
 * THIS MODULE IS THE ONE THE CLIENT BUNDLE MUST NOT REACH. It is the only place the four
 * deferrable components are imported statically, so anything importing it pulls all four into
 * whatever chunk it lands in. `browser/index.ts` therefore imports the deferred registry
 * instead, and `client-bundle.spec.ts` reads the built file for the marker that proves it.
 *
 * THE HEALTH POSITION IS WHERE THE ONE SERVER SIDE SLOT IS RESOLVED, and it is resolved here
 * rather than in the page because of what fills the same position in the browser: an element
 * that adopts the markup it was handed, per SPEC 7.2 and 12. Resolving `HealthScore` on both
 * sides would have the client draw a theme's component over markup it is supposed to leave
 * alone; resolving it only here means whatever the theme draws is what the reader receives.
 */

import { useSlot } from '@openref/vue';
import { h, type Component, type VNode } from 'vue';
import { CommandPalette } from './CommandPalette';
import { HealthPanel } from './HealthPanel';
import { SchemaView } from './SchemaView';
import { TryItPanel } from './TryItPanel';
import type { DeferrableComponents } from './deferrable';
import type { HealthModel } from '@openref/vue';

/** Draws the Health panel the theme put in the position, or the one this package ships. */
const HealthScore: Component = (props: { readonly health: HealthModel }): VNode =>
  h(useSlot('HealthScore', HealthPanel).value, { health: props.health });

/** Every deferrable component, resolved at import time. */
export const EAGER_COMPONENTS: DeferrableComponents = {
  schemaView: SchemaView,
  tryIt: TryItPanel,
  commandPalette: CommandPalette,
  healthPanel: HealthScore,
};
