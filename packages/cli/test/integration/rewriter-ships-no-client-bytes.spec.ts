import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The SPEC 20 half of the `ts-morph` decision, measured rather than asserted.
 *
 * THE BUDGETS OF SPEC 20 GOVERN CLIENT BYTES, AND THIS DEPENDENCY HAS TO REACH NONE. It is a
 * TypeScript compiler with a tree on top, so a version of this project where it did reach a page
 * would be a version where the reference costs a reader twelve megabytes. Saying it does not, on
 * the grounds that the CLI is a command line tool, is exactly the reasoning SPEC 0 calls out with
 * `playwright-core`: the zones answer whether a package may ship, never whether it did.
 *
 * SO THE PROOF ASSERTS PRESENCE BEFORE IT ASSERTS ABSENCE. A scan that finds no occurrence of a
 * name proves nothing until the same scan has found one somewhere it must be, which is why the
 * CLI's own bundle is read with the same reader and the same needle first. Without that, an empty
 * directory, a renamed artifact or a typo in the needle all read as a clean result.
 */

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));

/** The needle: the package name as it appears in an import, a require or a chunk banner. */
const NEEDLE = 'ts-morph';

/** The bundles a served reference makes a browser load, as `tools/gates` names them. */
const CLIENT_ROOTS: readonly string[] = [
  'packages/nest/dist/browser',
  'packages/nest/dist/browser-wc',
  'packages/nest/dist/browser-iife',
  'packages/theme/dist/browser',
];

/** Every file under a directory, recursively. */
function filesUnder(root: string): readonly string[] {
  if (!existsSync(root)) return [];
  if (!statSync(root).isDirectory()) return [root];

  return readdirSync(root, { withFileTypes: true }).flatMap((entry) =>
    filesUnder(join(root, entry.name)),
  );
}

/** Which of the given files carry the needle. */
function carrying(files: readonly string[], needle: string): readonly string[] {
  return files.filter((file) => readFileSync(file, 'utf8').includes(needle));
}

describe('the AST dependency of doctor --fix', () => {
  it('should be readable by this scan inside the CLI bundle, which is where it must be', () => {
    // Given
    // THE WHOLE DIST AND NOT `bin.js`, MEASURED RATHER THAN GUESSED. The first version of this
    // case read `bin.js` alone and found nothing, because tsup splits the two entry points and
    // the import lands in a shared chunk. The needle was right and the haystack was wrong, which
    // is the reading this half of the proof exists to catch before the other half runs.
    const dist = join(REPO, 'packages/cli/dist');
    expect(
      existsSync(dist),
      'packages/cli/dist is not built, so this proof has nothing to read. Run pnpm build',
    ).toBe(true);

    // When
    const found = carrying(filesUnder(dist), NEEDLE);

    // Then
    expect(found.length).toBeGreaterThan(0);
  });

  it('should reach no bundle a browser loads, which is what the SPEC 20 budgets govern', () => {
    // Given
    const files = CLIENT_ROOTS.flatMap((root) => filesUnder(join(REPO, root)));
    expect(
      files.length,
      'no client bundle was found at all, so this proof measured nothing. Run pnpm build',
    ).toBeGreaterThan(0);

    // When
    const found = carrying(files, NEEDLE);

    // Then
    expect(found).toEqual([]);
  });

  it('should be declared by the CLI alone, since nothing else in the workspace may parse source', () => {
    // Given
    const packages = readdirSync(join(REPO, 'packages'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(REPO, 'packages', entry.name, 'package.json'))
      .filter((manifest) => existsSync(manifest));
    expect(packages.length).toBeGreaterThan(1);

    // When
    const declaring = packages.filter((manifest) => {
      const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as {
        readonly name?: string;
        readonly dependencies?: Readonly<Record<string, string>>;
        readonly devDependencies?: Readonly<Record<string, string>>;
      };
      const all = { ...parsed.dependencies, ...parsed.devDependencies };
      return NEEDLE in all;
    });

    // Then
    expect(declaring).toHaveLength(1);
    expect(declaring[0]).toBe(join(REPO, 'packages', 'cli', 'package.json'));
  });
});
