/**
 * Refuses a release that would put a placeholder version on npm.
 *
 * WHAT THE RELEASE PROCESS EXPECTS, STATED PLAINLY, BECAUSE NOTHING STATED IT BEFORE. Every
 * publishable manifest in this repository carries `"version": "0.0.0"`, and that is not a version,
 * it is the placeholder for "never released". The version that actually ships is written by
 * `changeset version`, which reads the markdown files under `.changeset/` and raises each package in
 * its fixed group accordingly. So a release is three things in order: a changeset describing the
 * change, `changeset version` turning the accumulated changesets into real versions and a commit,
 * and only then a tag whose workflow publishes what that commit holds.
 *
 * WHAT WENT WRONG WITHOUT THIS. `.changeset/` held no changeset and every manifest still said
 * 0.0.0, so pushing a `v*` tag would have run `changeset publish` over eleven packages at 0.0.0 and
 * put that on the registry. Nothing anywhere would have gone red: the gates check the set that
 * publishes and what each package carries, not what version it carries, and 0.0.0 is a perfectly
 * valid semantic version. The done-when clause "a fresh consumer installs from npm" was therefore
 * unverifiable, since the thing a consumer would have installed did not exist yet.
 *
 * WHY A SCRIPT IN THE WORKFLOW AND NOT A GATE. `pnpm gates` runs on every task, and the tree it
 * runs on is supposed to sit at 0.0.0 with no changeset for as long as nothing has been released.
 * A gate asserting otherwise would be red on every green day, which is how a gate stops being read.
 * This is a release precondition, so it runs where a release runs, and it fails the publish job
 * before `changeset publish` is reached.
 *
 * Plain ESM with no dependencies, on the `module-floor-check.mjs` precedent, so it can run before
 * anything is installed and can be pointed at a fixture tree by a test.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The version every unreleased manifest in this repository carries. */
const PLACEHOLDER_VERSION = '0.0.0';

/** Files under `.changeset/` that are configuration or prose rather than a changeset. */
const NOT_A_CHANGESET = new Set(['README.md', 'config.json']);

/**
 * Reads every publishable workspace manifest under `packages/`.
 *
 * The `private` flag is the same rule `pnpm publish` and `changeset publish` follow, so the set
 * read here is the set that would go out. It is deliberately not a hand written list: this script
 * has to be right about what a publish emits, and the manifests are what decides that.
 *
 * @param {string} root - Absolute repository root
 * @returns {{name: string, version: string, directory: string}[]} One entry per publishable package
 */
export function publishableManifests(root) {
  const packages = join(root, 'packages');
  let entries = [];

  try {
    entries = readdirSync(packages).sort();
  } catch {
    return [];
  }

  const manifests = [];

  for (const entry of entries) {
    let raw;
    try {
      raw = JSON.parse(readFileSync(join(packages, entry, 'package.json'), 'utf8'));
    } catch {
      continue;
    }

    if (typeof raw.name !== 'string' || raw.private === true) continue;

    manifests.push({
      name: raw.name,
      version: typeof raw.version === 'string' ? raw.version : '',
      directory: `packages/${entry}`,
    });
  }

  return manifests;
}

/**
 * The pending changesets, by file name.
 *
 * @param {string} root - Absolute repository root
 * @returns {string[]} Changeset file names, empty when none are pending
 */
export function pendingChangesets(root) {
  try {
    return readdirSync(join(root, '.changeset'))
      .filter((name) => name.endsWith('.md') && !NOT_A_CHANGESET.has(name))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Decides whether this tree may be published.
 *
 * @param {{name: string, version: string, directory: string}[]} manifests - Publishable packages
 * @param {string[]} changesets - Pending changeset file names
 * @returns {{ok: boolean, lines: string[]}} The verdict and what to print
 */
export function checkReleaseReadiness(manifests, changesets) {
  const lines = [];

  // A READING THAT FOUND NOTHING REPORTS WHAT A CLEAN ONE DOES, so say which happened. An empty
  // set here would otherwise satisfy "no package is at the placeholder version" for free.
  if (manifests.length === 0) {
    lines.push('no publishable package was found, so nothing was checked and nothing was proved.');

    return { ok: false, lines };
  }

  const placeholder = manifests.filter((manifest) => manifest.version === PLACEHOLDER_VERSION);
  const unversioned = manifests.filter((manifest) => manifest.version === '');

  lines.push(
    `${manifests.length} publishable packages, ${placeholder.length} still at ${PLACEHOLDER_VERSION}, ${changesets.length} pending changeset(s).`,
  );

  for (const manifest of unversioned) {
    lines.push(`  ${manifest.name} (${manifest.directory}) declares no version at all.`);
  }

  for (const manifest of placeholder) {
    lines.push(`  ${manifest.name} (${manifest.directory}) is at ${PLACEHOLDER_VERSION}.`);
  }

  if (placeholder.length === 0 && unversioned.length === 0) {
    lines.push('every publishable package carries a released version.');

    return { ok: true, lines };
  }

  lines.push('');
  lines.push(
    `${PLACEHOLDER_VERSION} is this repository's placeholder for "never released". Publishing it`,
  );
  lines.push('would put a package on the registry that no changelog and no tag describes.');
  lines.push('');

  if (changesets.length === 0) {
    lines.push('There is no pending changeset either, so `changeset version` has nothing to raise');
    lines.push('these with. Write one with `pnpm changeset`, let the version pull request land,');
    lines.push('and tag the commit it produced.');
  } else {
    lines.push(
      `There are ${changesets.length} pending changeset(s): ${changesets.join(', ')}. They have not been`,
    );
    lines.push('applied yet. Let `changeset version` run and land its pull request, then tag the');
    lines.push('commit it produced rather than this one.');
  }

  return { ok: false, lines };
}

const root = process.argv.includes('--root')
  ? process.argv[process.argv.indexOf('--root') + 1]
  : join(dirname(fileURLToPath(import.meta.url)), '..');

const verdict = checkReleaseReadiness(publishableManifests(root), pendingChangesets(root));

for (const line of verdict.lines) console.log(line);

if (!verdict.ok) {
  console.log('');
  console.log('Refusing to publish. This is the release precondition, not a gate to be relaxed.');
  process.exitCode = 1;
}
