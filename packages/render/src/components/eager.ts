/**
 * The registry that compiles everything up front, which is what a server render needs.
 *
 * THIS MODULE IS THE ONE THE CLIENT BUNDLE MUST NOT REACH. It is the only place the three
 * deferrable components are imported statically, so anything importing it pulls all three into
 * whatever chunk it lands in. `browser/index.ts` therefore imports the deferred registry
 * instead, and `client-bundle.spec.ts` reads the built file for the marker that proves it.
 */

import { CommandPalette } from './CommandPalette';
import { SchemaView } from './SchemaView';
import { TryItPanel } from './TryItPanel';
import type { DeferrableComponents } from './deferrable';

/** Every deferrable component, resolved at import time. */
export const EAGER_COMPONENTS: DeferrableComponents = {
  schemaView: SchemaView,
  tryIt: TryItPanel,
  commandPalette: CommandPalette,
};
