/**
 * The supported Node range, derived from the dependency tree rather than typed by hand.
 *
 * WHY THIS IS COMPUTED. The range this project declares is a promise to a reader, and it is only
 * as true as the narrowest range in the tree underneath it. A hand mirrored constant is true on
 * the day it is written and drifts silently the moment a dependency raises its own floor: the
 * package stops working on a runtime we still advertise, and the report reads as a user on an
 * unsupported version rather than as a stale manifest. That is exactly how `>=20.11.0` survived
 * long after `jsdom` had dropped Node 20.
 *
 * So the check is the same shape as the reserved font name check and the `unicode-range` check:
 * read the artefact, not the value someone typed. Here the artefact is every `engines.node` in
 * the production closure, and the question is whether what we declare is a subset of all of
 * them.
 *
 * A DEPENDENCY THAT DECLARES NOTHING CONSTRAINS NOTHING. Most packages leave `engines` out, and
 * absence is not a claim of universal support; it only means the question was never answered.
 * Reading it as `*` is the one honest option, and it is why this cannot replace testing on the
 * floor: the load check in CI is what turns an undeclared incompatibility into a red build.
 */

import { subset, validRange } from 'semver';

/** One package in the production closure and what it says about Node. */
export interface DeclaredEngine {
  /** Package name and version, as the licence report keys them. */
  readonly package: string;
  /** The `engines.node` range it declares. */
  readonly range: string;
}

/** A dependency whose declared range does not contain ours. */
export interface EngineFinding {
  readonly package: string;
  readonly range: string;
  readonly reason: string;
}

/**
 * Checks the declared range against every range in the closure.
 *
 * @param declared - The range this project declares
 * @param dependencies - Every production dependency that declares one
 * @returns One finding per dependency that supports less than we promise
 * @throws Error when the declared range is not a range at all
 */
export function auditEngineRange(
  declared: string,
  dependencies: readonly DeclaredEngine[],
): EngineFinding[] {
  if (validRange(declared) === null) {
    throw new Error(`the declared engines.node is "${declared}", which is not a valid range`);
  }

  const findings: EngineFinding[] = [];

  for (const dependency of dependencies) {
    if (validRange(dependency.range) === null) {
      findings.push({
        package: dependency.package,
        range: dependency.range,
        reason: 'declares an engines.node that is not a valid range, so it cannot be checked',
      });
      continue;
    }

    if (!subset(declared, dependency.range)) {
      findings.push({
        package: dependency.package,
        range: dependency.range,
        reason: 'supports less than this project promises, so the promise cannot be kept',
      });
    }
  }

  return findings;
}

/**
 * The narrowest declared range in a set, for the message when the check fails.
 *
 * There is no single narrowest range in general, since ranges are not totally ordered. This
 * returns the ones our declaration is not a subset of, which is what a reader has to satisfy
 * all of at once.
 *
 * @param findings - What the audit produced
 * @returns A readable list of the ranges that have to be intersected
 */
export function describeConstraints(findings: readonly EngineFinding[]): string {
  return findings.map((finding) => `${finding.package} wants ${finding.range}`).join('; ');
}

/**
 * Reads the workspace manifests' declared ranges, so they cannot disagree with each other.
 *
 * Every published package makes the same promise, because a consumer installing two of them
 * gets one runtime. A package that declared a wider range would be advertising support that the
 * package beside it does not have.
 *
 * @param manifests - Package name to its declared `engines.node`, undefined when it declares none
 * @returns Names that declare something other than the reference range
 */
export function findDivergentManifests(
  reference: string,
  manifests: readonly { readonly name: string; readonly range: string | undefined }[],
): string[] {
  return manifests
    .filter((manifest) => manifest.range !== reference)
    .map(
      (manifest) =>
        `${manifest.name} declares ${manifest.range === undefined ? 'no engines.node' : `"${manifest.range}"`}`,
    );
}
