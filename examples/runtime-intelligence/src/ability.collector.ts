import type { CollectorContext, IRuntimeCollector } from '@openref/nest';

/**
 * A collector written by hand, and the whole of what that takes.
 *
 * IT IS THE EXAMPLE IN `docs/guide/04-collectors.md`, AND THE SAME BYTES. The guide's fenced
 * block is compiled by `documentation-examples.spec.ts`, so a change here that the guide does
 * not follow is a failing test rather than a page that has quietly gone stale.
 *
 * `derived` AND NOT `declared`, WHICH IS THE ONE WAY A COLLECTOR CAN LIE. The rules were read
 * from a metadata key. Nobody wrote a statement about this route's scopes, so calling the fact
 * `declared` would report an inference as somebody's promise, and the page draws those
 * differently on purpose.
 */
export const ABILITY_COLLECTOR_NAME = 'abilityCollector';

/** One rule of the authorization library this application happens to use. */
interface AbilityRule {
  readonly action: string;
  readonly subject: string;
}

/**
 * Whether one value off the metadata key is a rule.
 *
 * NARROWED RATHER THAN CAST, because the value came off a metadata key and a key is whatever
 * the application put there. A cast here would turn a misconfigured decorator into a scope
 * named `undefined:undefined` on a real endpoint.
 *
 * @param value - Whatever was on the key
 * @returns Whether it can be read as a rule
 */
function isAbilityRule(value: unknown): value is AbilityRule {
  if (typeof value !== 'object' || value === null) return false;
  const rule = value as { action?: unknown; subject?: unknown };
  return typeof rule.action === 'string' && typeof rule.subject === 'string';
}

/**
 * Reads an authorization library's ability rules as the scopes a route requires.
 *
 * THE RETURN TYPE IS INFERRED AND CHECKED AGAINST THE CONTRACT rather than annotated, because
 * `IRNodeRuntime` lives in `@openref/core` and `@openref/nest` does not re-export it. Writing
 * the annotation would make a collector author install a second package for one type name, so
 * the object literal is contextually typed by `IRuntimeCollector` instead, which checks the
 * same thing.
 *
 * @param options - The metadata key this application writes its rules under
 * @returns The collector, ready to register
 */
export function abilityCollector(options: { readonly metadataKey: string }): IRuntimeCollector {
  return {
    name: ABILITY_COLLECTOR_NAME,

    collect(context: CollectorContext) {
      const declared: unknown = context.reflector.get(options.metadataKey, context.handler);
      if (!Array.isArray(declared)) return undefined;

      const scopes = declared.filter(isAbilityRule).map((rule) => `${rule.subject}:${rule.action}`);
      if (scopes.length === 0) return undefined;

      return { scopes: context.fact(scopes, 'derived') };
    },
  };
}
