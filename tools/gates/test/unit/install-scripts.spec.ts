import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * SPEC 19.5, the half of zero telemetry that happens before any page is served.
 *
 * The other half is about the shipped bundle and is covered twice, by the browser proof that
 * watches a page load and by the scan for foreign origins in `bundle-origins.ts`. Neither of
 * them can see the thing that happens at `pnpm install`: a dependency's `postinstall` reporting
 * the install to somebody. That call is made by a package this project did not write, on a
 * machine it does not own, before any of its own code has run.
 *
 * pnpm refuses install scripts by default and takes an explicit list of exceptions, which is
 * the right default and is also a setting somebody can widen in one line while fixing something
 * else. So the list is asserted rather than trusted: what may run has to be named here, and a
 * new name has to be looked at.
 */

const repoRoot = join(import.meta.dirname, '..', '..', '..', '..');

/**
 * The install scripts this repository permits, and why each one is not a call home.
 *
 * One entry. `esbuild` compiles a native binary at install and does nothing else; without it
 * nothing in this repository builds. It is not analytics and it does not report anything.
 */
const ALLOWED_BUILDS: readonly string[] = ['esbuild'];

/**
 * The packages refused by name, with the reason each one is refused.
 *
 * Both arrive through the compatibility fixtures of SPEC 23 and neither is needed for anything
 * to work. Refusing the script does not remove the package, it removes the call home.
 */
const REFUSED: readonly string[] = ['@nestjs/core', '@scarf/scarf'];

/** The `allowBuilds` block, read as pairs rather than parsed as YAML. */
function allowBuilds(): Map<string, boolean> {
  const text = readFileSync(join(repoRoot, 'pnpm-workspace.yaml'), 'utf8');
  const entries = new Map<string, boolean>();

  let inside = false;
  for (const line of text.split('\n')) {
    if (/^allowBuilds:/.test(line)) {
      inside = true;
      continue;
    }

    if (inside && /^\S/.test(line)) inside = false;
    if (!inside) continue;

    const match = /^\s+'?([^':]+)'?:\s*(true|false)\s*$/.exec(line);
    if (match === null) continue;

    entries.set(match[1] ?? '', match[2] === 'true');
  }

  return entries;
}

describe('install scripts', () => {
  it('should permit only the builds that are named and justified here', () => {
    // Given the block as the repository commits it
    const entries = allowBuilds();

    // When
    const permitted = [...entries.entries()].filter(([, allowed]) => allowed).map(([name]) => name);

    // Then a package that gained an install script has to be looked at rather than absorbed
    expect(permitted.sort()).toEqual([...ALLOWED_BUILDS].sort());
  });

  it('should refuse the two packages that report an install to somebody', () => {
    // Given, SPEC 19.5 puts telemetry at zero and both of these phone home on install
    const entries = allowBuilds();

    // When
    // Then
    for (const name of REFUSED) {
      expect(entries.get(name)).toBe(false);
    }
  });

  it('should read a block that is really there, so an empty parse cannot pass', () => {
    // Given, because a parser that quietly returned nothing would make both assertions above
    // pass while checking nothing at all
    const entries = allowBuilds();

    // When
    // Then
    expect(entries.size).toBeGreaterThanOrEqual(REFUSED.length + ALLOWED_BUILDS.length);
  });
});
