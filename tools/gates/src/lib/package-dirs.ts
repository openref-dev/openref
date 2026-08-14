/**
 * The set of packages under `packages/`, read from the disk rather than maintained.
 *
 * THERE IS ONE READER OF THIS SET IN THE REPOSITORY AND IT IS NOT HERE. `tools/dependency-rules.cjs`
 * owns it, because the dependency graph configuration has to have it in CommonJS before anything
 * is built, and this module calls that one. A second implementation here would be two derivations
 * of one fact, which is a smaller version of the defect both exist to remove: until 2026-08-11 the
 * set was a hand written array in `.dependency-cruiser.cjs` and another in `config.ts`, and nothing
 * compared either to the disk or to the other. A package missing from them was in no boundary
 * rule's `to` path and its built output was scanned for nothing. Filed as F23.
 *
 * The cost of reaching across is one `require` of a committed file. The alternative was six lines
 * of `readdirSync` that agree with the other six lines until the day they do not.
 */

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { SHIPPED_CLIENT_BUNDLES } from '../config.js';

/** Repository relative path of the module that owns the derivation. */
const RULES_MODULE = 'tools/dependency-rules.cjs';

/** The part of that module's surface this one uses. */
interface DependencyRulesModule {
  readPackageDirs(repoRoot: string): string[];
}

const requireFrom = createRequire(import.meta.url);

/**
 * Reads the package directory names under `packages/`.
 *
 * @param repoRoot - Absolute repository root
 * @returns Directory names, sorted
 * @throws {Error} When `tools/dependency-rules.cjs` is not in the checkout
 */
export function readPackageDirs(repoRoot: string): readonly string[] {
  const module = requireFrom(join(repoRoot, RULES_MODULE)) as DependencyRulesModule;

  return module.readPackageDirs(repoRoot);
}

/**
 * Directories holding built output, one per package, scanned for CSP violations.
 *
 * A PACKAGE THAT SHIPS NOTHING STILL GETS A ROOT HERE, and the gate counts what it finds. A
 * package added to the repository is scanned from the moment its directory exists, which is the
 * half of F23 that had nothing to do with the dependency graph: the same hand list drove this, so
 * a ninth package's `dist` was never opened while the gate printed a file count and passed.
 *
 * @param repoRoot - Absolute repository root
 * @returns Repository relative directories
 */
export function cspScanRoots(repoRoot: string): readonly string[] {
  return readPackageDirs(repoRoot).map((dir) => `packages/${dir}/dist`);
}

/**
 * Directories holding built output a browser loads as modules, one per package.
 *
 * DERIVED THE SAME WAY AND FOR THE SAME REASON AS THE CSP ROOTS. `dist/browser` is where every
 * package that builds for a browser puts it, so a package added to the repository is scanned from
 * the moment its directory exists. A package that builds nothing for a browser has no such
 * directory and contributes no files, which the resolution gate counts rather than assumes: a
 * scan that found nothing anywhere is a build that has not run, and it says so.
 *
 * @param repoRoot - Absolute repository root
 * @returns Repository relative directories
 */
export function browserScanRoots(repoRoot: string): readonly string[] {
  const conventional = readPackageDirs(repoRoot).map((dir) => `packages/${dir}/dist/browser`);

  // AND EVERY ROOT THE BUNDLE REGISTRY DECLARES, since T033: the Web Component and themed
  // entry outputs live outside the `dist/browser` convention, and the registry is the one
  // place that knows a browser artefact exists, so the scan follows it rather than trusting
  // the convention to stay the whole story. The reconciliation in the gate still runs both
  // ways, which is what caught the two the convention missed.
  const declared = SHIPPED_CLIENT_BUNDLES.flatMap((bundle) => bundle.roots);

  return [...new Set([...conventional, ...declared])];
}
