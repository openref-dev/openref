import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadFromNestApplication } from '../../src/cli/infrastructure/adapters/nest-application.adapter';
import { SPAWNED_PROCESS_TIMEOUT_MS } from '../../../../vitest.spawn-timeout.ts';

/**
 * Against the real demo, not a fixture: `examples/nest-minimal` installs the real
 * `@openref/nest`, so this is the proof that the duck typed read of `OPENREF_REFERENCES` in
 * `nest-application.adapter.ts` still matches what `MountedReferences.all()` actually returns,
 * rather than only what this package's own fixtures say it returns.
 *
 * REQUIRES `examples/nest-minimal` BUILT FIRST, per the same precondition
 * `tools/browser-budget/test/integration/readme-reproduction.spec.ts` already carries for the
 * same application.
 *
 * BOTH CASES DECLARE `SPAWNED_PROCESS_TIMEOUT_MS`, PER THE SAME RULE THAT NAMES IT, even though
 * neither spawns a process. What that constant protects against is a case whose cost is a real
 * NestJS application booting rather than the assertion itself, and that is exactly what
 * `loadFromNestApplication` does here, in process, under the coverage run's V8 instrumentation:
 * the first version of this file timed out at the ordinary 5 second default on that run alone. A
 * second constant for the same class, in process rather than spawned, is the class the vocabulary
 * rule refuses: one cost, one declared number.
 */
const DEMO_ENTRY = fileURLToPath(
  new URL('../../../../examples/nest-minimal/dist/main.js', import.meta.url),
);

describe.skipIf(!existsSync(DEMO_ENTRY))('loadFromNestApplication, against the real demo', () => {
  it(
    "should extract the demo's real document, with real operations, and close cleanly",
    async () => {
      // Given
      const entry = DEMO_ENTRY;

      // When
      const loaded = await loadFromNestApplication(entry);

      // Then
      expect(loaded.document.info.title).toBe('Orders');
      expect(loaded.document.nodes.size).toBeGreaterThan(0);
      await expect(loaded.close()).resolves.toBeUndefined();
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it(
    "should carry runtime facts the demo's collectors produced, not only spec facts",
    async () => {
      // Given
      const loaded = await loadFromNestApplication(resolve(DEMO_ENTRY));

      // When
      const nodes = [...loaded.document.nodes.values()];

      // Then
      expect(nodes.some((node) => node.runtime !== undefined)).toBe(true);
      await loaded.close();
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );
});
