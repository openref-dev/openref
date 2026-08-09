/**
 * The set of workspace packages whose contents reach a consumer.
 *
 * The license policy separates two zones, and the line between them is not
 * `dependencies` versus `devDependencies` at the workspace root. It is what ends up
 * inside a published tarball. Two things get there:
 *
 * - a package that is published, because it is not `private`
 * - a package that is `private` but bundled into a published one, because its runtime
 *   dependencies are inlined into the published bundle rather than installed beside it
 *
 * The second case is why the workspace root's production tree is the wrong thing to
 * check. `@openref/render` sits in the `devDependencies` of `@openref/nest`, is bundled
 * into it, and anything it pulls in ships to the consumer all the same.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Directories under the repository root that pnpm-workspace.yaml globs. */
const WORKSPACE_ROOTS: readonly string[] = ['packages', 'tools'];

/** One workspace package, reduced to what the shipped set is computed from. */
export interface WorkspaceManifest {
  readonly directory: string;
  readonly name: string;
  readonly isPrivate: boolean;
  readonly dependencies: readonly string[];
  readonly developmentDependencies: readonly string[];
}

interface RawManifest {
  readonly name?: unknown;
  readonly private?: unknown;
  readonly dependencies?: unknown;
  readonly optionalDependencies?: unknown;
  readonly devDependencies?: unknown;
}

function namesOf(value: unknown): string[] {
  if (typeof value !== 'object' || value === null) return [];
  return Object.keys(value);
}

/**
 * Reads every workspace manifest under `packages/` and `tools/`.
 *
 * @param repoRoot - Absolute repository root
 * @returns One entry per workspace package, ordered by directory
 */
export function readWorkspaceManifests(repoRoot: string): WorkspaceManifest[] {
  const manifests: WorkspaceManifest[] = [];

  for (const root of WORKSPACE_ROOTS) {
    let entries: string[];
    try {
      entries = readdirSync(join(repoRoot, root)).sort();
    } catch {
      continue;
    }

    for (const entry of entries) {
      const directory = `${root}/${entry}`;
      let raw: RawManifest;
      try {
        raw = JSON.parse(
          readFileSync(join(repoRoot, directory, 'package.json'), 'utf8'),
        ) as RawManifest;
      } catch {
        continue;
      }

      if (typeof raw.name !== 'string') continue;

      manifests.push({
        directory,
        name: raw.name,
        isPrivate: raw.private === true,
        dependencies: [...namesOf(raw.dependencies), ...namesOf(raw.optionalDependencies)],
        developmentDependencies: namesOf(raw.devDependencies),
      });
    }
  }

  return manifests;
}

/** The workspace packages that reach a consumer, split by how they get there. */
export interface ShippedPackages {
  /** Packages published to npm as their own tarball. */
  readonly published: readonly string[];
  /** Private packages inlined into a published bundle. */
  readonly bundled: readonly string[];
  /** The union, sorted, and the scope the production license policy applies to. */
  readonly shipped: readonly string[];
}

/**
 * Computes the shipped set from the workspace manifests.
 *
 * A private workspace package reachable from a published one by any declared edge is
 * treated as bundled. The edge kind carries no information here: an internal package is
 * kept in `devDependencies` precisely because it is bundled rather than installed, so
 * reading `devDependencies` as "not shipped" would invert the truth.
 *
 * @param manifests - Every workspace manifest
 * @returns The published set, the bundled set and their union
 */
export function resolveShippedPackages(manifests: readonly WorkspaceManifest[]): ShippedPackages {
  const byName = new Map(manifests.map((manifest) => [manifest.name, manifest]));
  const published = manifests
    .filter((manifest) => !manifest.isPrivate)
    .map((manifest) => manifest.name)
    .sort();

  const bundled = new Set<string>();
  const queue = [...published];

  while (queue.length > 0) {
    const name = queue.shift();
    if (name === undefined) break;

    const manifest = byName.get(name);
    if (manifest === undefined) continue;

    for (const edge of [...manifest.dependencies, ...manifest.developmentDependencies]) {
      const target = byName.get(edge);
      if (target === undefined || !target.isPrivate || bundled.has(target.name)) continue;
      bundled.add(target.name);
      queue.push(target.name);
    }
  }

  const shipped = [...new Set([...published, ...bundled])].sort();

  return { published, bundled: [...bundled].sort(), shipped };
}
