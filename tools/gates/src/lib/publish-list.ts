/**
 * What a release publishes, held against what SPEC 4 says it publishes.
 *
 * THE LIST IS A FACT ABOUT THE MANIFESTS AND A CLAIM IN A DOCUMENT, AND THE TWO HAVE DRIFTED
 * BEFORE. `@openref/theme-telltale` became publishable at T032; SPEC 4 recorded it and
 * `PROJECT-STANDARDS.md` 3.1 did not, and neither had a reader, so for five milestones the two
 * tables disagreed and the release job would have published whichever the manifests happened to
 * say. That is what this exists for: the manifests decide, and the documents are checked against
 * them rather than trusted.
 *
 * THREE QUESTIONS, ASKED SEPARATELY BECAUSE THEY FAIL SEPARATELY.
 *
 * 1. Would a publish emit exactly the intended set? Answered from `pnpm publish --dry-run`, which
 *    is the command a release runs, rather than from a rule about `private` that restates it.
 * 2. Would an internal package go out? It is the same set difference, and it is reported on its
 *    own because it is the failure BUILD.md T064 names by hand, and a reader who sees one line
 *    about a set difference does not necessarily read it as "an internal package is about to be
 *    published".
 * 3. Does what goes out carry what it is obliged to carry? A licence text, a repository field
 *    provenance cannot be attested without, and an access setting a scoped package cannot publish
 *    without.
 *
 * THE SECOND QUESTION IS ASKED OF THE INTENDED SET AND NOT OF THE `private` MARKING, and it was the
 * other way round until the post T064 review. `isPrivate` is `private === true`, which is exactly
 * the rule `pnpm publish` itself follows, so the set of names a dry run prints and the set of names
 * marked private never intersect and the branch that reported their intersection could not fire on
 * any tree. What actually happens is a manifest that loses the marking: the package is then
 * publishable and unmarked at once, the dry run names it, and the only thing that knows it should
 * not have gone out is the committed intended set. So the intended set is what it is asked against.
 *
 * A DRY RUN MAKES NO NETWORK REQUEST, AND THE GATE MAKES THAT TRUE RATHER THAN HOPING IT. The child
 * is given `npm_config_registry=http://127.0.0.1:1/`, an address nothing answers on, so a run that
 * needed the registry would fail rather than reach it. Measured 2026-09-01: it prints all eleven
 * lines and exits 0. The case that pins the property is `should name every published package from a
 * dry run that could not have reached a registry` in
 * `tools/gates/test/unit/publish-list.spec.ts`, which asserts the gate passes that variable to the
 * child; the run itself is exercised end to end by `should pass on this repository` in
 * `tools/gates/test/integration/gates.spec.ts`.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GateFinding } from '../types.js';
import type { WorkspaceManifest } from './workspace.js';

/** The `📦 <name>@<version> → <registry>` line pnpm prints once per package it would publish. */
const DRY_RUN_LINE = /^📦\s+(\S+?)@\d[^\s]*\s/gm;

/** A table row of a published list: `| \`@openref/nest\` | ... |`. */
const SPEC_TABLE_ROW = /^\|\s*`([^`]+)`\s*\|/gm;

/** Any backticked name, used for the prose lists the documents keep their other two sets in. */
const SPEC_BACKTICKED = /`([^`]+)`/g;

/** What a published manifest is obliged to declare, beyond a licence file beside it. */
interface DeliveryRequirement {
  readonly access: string;
}

/**
 * What a published manifest owes that is the same on every tree.
 *
 * THE REPOSITORY IS NOT HERE ANY MORE, AND ITS ABSENCE IS THE FIX. It was a literal,
 * `git+https://github.com/openref/openref.git`, and the manifests said `openref-dev/openref`,
 * which is what `git remote` says too. A literal cannot be the authority on which of the two is
 * right, because npm attests a provenance statement against the repository the build actually runs
 * in and against nothing anybody typed. So the expected address is derived from that repository now
 * and there is no second copy left to drift. See {@link resolveBuildRepository}.
 */
export const PROVENANCE_REQUIREMENT: DeliveryRequirement = {
  access: 'public',
};

/** Where the repository a release would be attested against was read from. */
export interface BuildRepository {
  /** `owner/name`, or null when neither source could answer. */
  readonly slug: string | null;
  /** The source that answered, or the reason none could. */
  readonly source: string;
}

/** `owner/name` out of any of the forms git and GitHub write a repository address in. */
const REPOSITORY_SLUG = /^(?:[^/]+[:/])??([^/:]+)\/([^/]+?)(?:\.git)?$/;

/**
 * Reads `owner/name` out of a git remote, in any of the forms one is written in.
 *
 * Handles `git@github.com:owner/name.git`, `https://github.com/owner/name(.git)`,
 * `ssh://git@github.com/owner/name.git` and the bare `owner/name` GitHub Actions exports.
 *
 * @param remote - A remote url, or `owner/name`
 * @returns The slug, or null when the address is not a GitHub repository
 */
export function parseRepositorySlug(remote: string): string | null {
  const trimmed = remote.trim().replace(/^ssh:\/\/|^https?:\/\//, '');
  if (trimmed === '' || !/github\.com|^[^/:]+\/[^/]+$/.test(trimmed)) return null;

  const path = trimmed.replace(/^[^/]*github\.com[:/]/, '');
  const match = REPOSITORY_SLUG.exec(path);
  if (match === null) return null;

  const owner = match[1] ?? '';
  const name = match[2] ?? '';

  return owner === '' || name === '' ? null : `${owner}/${name}`;
}

/**
 * The repository a publish from this checkout would be attested against.
 *
 * `GITHUB_REPOSITORY` is preferred where it is set, because on a runner it is literally the
 * repository the workflow belongs to and is what the provenance statement will name. Off a runner
 * the `origin` remote is the same fact as this checkout knows it.
 *
 * @param githubRepository - The `GITHUB_REPOSITORY` environment variable, or undefined
 * @param originRemote - The configured `origin` url, or null when there is none
 * @returns The slug and where it came from, or a null slug and why
 */
export function resolveBuildRepository(
  githubRepository: string | undefined,
  originRemote: string | null,
): BuildRepository {
  if (githubRepository !== undefined && githubRepository.trim() !== '') {
    const slug = parseRepositorySlug(githubRepository);
    if (slug !== null) return { slug, source: 'GITHUB_REPOSITORY' };

    return {
      slug: null,
      source: `GITHUB_REPOSITORY is "${githubRepository}", which is not an owner/name pair`,
    };
  }

  if (originRemote === null) {
    return { slug: null, source: 'this checkout has no git repository or no origin remote' };
  }

  const slug = parseRepositorySlug(originRemote);
  if (slug !== null) return { slug, source: `the origin remote ${originRemote}` };

  return { slug: null, source: `the origin remote ${originRemote} is not a GitHub repository` };
}

/**
 * The `repository.url` a manifest has to declare for a publish from that repository to attest.
 *
 * @param slug - `owner/name`
 * @returns The url in the form npm compares
 */
export function repositoryUrlOf(slug: string): string {
  return `git+https://github.com/${slug}.git`;
}

/**
 * Reads the package names out of `pnpm publish --dry-run` output.
 *
 * @param output - Combined stdout and stderr of the dry run
 * @returns One name per package the run would publish, sorted
 */
export function parseDryRun(output: string): string[] {
  return [...output.matchAll(DRY_RUN_LINE)].map((match) => match[1] ?? '').sort();
}

/** The four sets a document states by hand. */
export interface SpecPackageLists {
  readonly published: readonly string[];
  readonly internal: readonly string[];
  readonly ecosystem: readonly string[];
  /**
   * Packages the documents state are deliberately not in the publish list.
   *
   * THE FOURTH SET, ADDED 2026-09-04 WITH THE RULING IT RECORDS. The other three answer "what goes
   * out"; a set difference against them can say a name is absent and can never say whether that was
   * meant. `@openref/nuxt` was absent from the published table for a measured licence reason that
   * lived only in prose, which is an absence no check could tell from an oversight.
   */
  readonly heldBack: readonly string[];
}

/** The headings one document writes its four lists under. */
export interface PackageListHeadings {
  readonly published: string;
  readonly internal: string;
  readonly ecosystem: string;
  readonly heldBack: string;
}

/** SPEC 4's headings, in the document's own Russian. */
export const SPEC_LIST_HEADINGS: PackageListHeadings = {
  published: '### Публичные (npm)',
  internal: '### Внутренние (не публикуются, бандлятся)',
  ecosystem: '### Экосистемные (отдельные пакеты, с M1)',
  heldBack: '### Придержанные (публикуются после 1.0)',
};

/**
 * `CLAUDE.md`'s headings, which state the same three sets a fourth time.
 *
 * THE FOURTH COPY IS WHY THIS EXISTS. Until the post T064 review this gate read SPEC 4 and the
 * committed constant, and `CLAUDE.md` was a hand written list nothing opened: it still called
 * `runner` and `theme-kit` internal after both were published, and its published table omitted
 * both. It is the file every session is told to read first, so a stale copy there is the one that
 * gets believed. Like `ai-docs/`, it is excluded from git, so the gate reports its absence rather
 * than reading a checkout that lacks it as clean.
 */
export const CLAUDE_LIST_HEADINGS: PackageListHeadings = {
  published: '### Published packages',
  internal: '### Internal packages (not published, bundled)',
  ecosystem: '### Ecosystem packages (separate, from M1)',
  heldBack: '### Packages held back from 1.0',
};

/**
 * Reads the three package lists a document states by hand.
 *
 * The published set is a table, the other two are prose lines of backticked names. The internal
 * names are written unscoped in that paragraph, exactly as both documents have always written
 * them, and are scoped here rather than in the documents.
 *
 * @param text - The whole document
 * @param headings - The headings that document writes the three lists under
 * @returns The three sets, each sorted, empty where the heading was not found
 */
export function readSpecPackageLists(
  text: string,
  headings: PackageListHeadings = SPEC_LIST_HEADINGS,
): SpecPackageLists {
  const sectionOf = (heading: string, stopAt: RegExp): string => {
    const start = text.indexOf(heading);
    if (start < 0) return '';

    const rest = text.slice(start + heading.length);
    const end = stopAt.exec(rest);

    return end === null ? rest : rest.slice(0, end.index);
  };

  const publishedSection = sectionOf(headings.published, /^#{2,3} /m);
  const internalSection = sectionOf(headings.internal, /^#{2,3} /m);
  const ecosystemSection = sectionOf(headings.ecosystem, /^#{2,3} /m);
  const heldBackSection = sectionOf(headings.heldBack, /^#{2,3} /m);

  const published = [...publishedSection.matchAll(SPEC_TABLE_ROW)]
    .map((match) => match[1] ?? '')
    .filter((name) => name.startsWith('@openref/') || name === 'openref')
    .sort();

  // The internal set is the first prose line after the heading, which is the list itself. Later
  // paragraphs of that subsection discuss it and name packages that are not in it.
  const internalLine = internalSection.split('\n').find((line) => line.trim().startsWith('`'));
  const internal = [...(internalLine ?? '').matchAll(SPEC_BACKTICKED)]
    .map((match) => `@openref/${match[1] ?? ''}`)
    .sort();

  const ecosystemLine = ecosystemSection.split('\n').find((line) => line.trim().startsWith('`'));
  const ecosystem = [...(ecosystemLine ?? '').matchAll(SPEC_BACKTICKED)]
    .map((match) => match[1] ?? '')
    .filter((name) => name.startsWith('@openref/'))
    .sort();

  // THE HELD BACK NAMES ARE READ SCOPED, LIKE THE ECOSYSTEM ONES AND UNLIKE THE INTERNAL ONES. Both
  // documents write an internal package unscoped, as `render`, because that paragraph is about
  // repository layout; a held back package is a name a consumer would type into an install command
  // one day, so it is written the way it will be published.
  const heldBackLine = heldBackSection.split('\n').find((line) => line.trim().startsWith('`'));
  const heldBack = [...(heldBackLine ?? '').matchAll(SPEC_BACKTICKED)]
    .map((match) => match[1] ?? '')
    .filter((name) => name.startsWith('@openref/') || name === 'openref')
    .sort();

  return { published, internal, ecosystem, heldBack };
}

/**
 * Compares what a publish would emit against the intended set.
 *
 * THE INTENDED SET IS THE SUBJECT, NOT THE `private` MARKING. See this file's header for why the
 * marking cannot be: `pnpm publish` skips a private package by its own rule, so the dry run's
 * output and the marked set are disjoint on every tree that can exist and the difference between
 * them was a branch nothing could redden. The manifests are still read, and what they are read for
 * is the diagnosis attached to each finding, which is the part a reader acts on: a package about to
 * go out is either unmarked, which is the failure BUILD.md T064 names by hand, or marked and
 * emitted anyway, which would mean pnpm did not follow its own rule.
 *
 * @param wouldPublish - Names read from the dry run
 * @param intended - The committed intended set
 * @param manifests - Every workspace manifest, for the diagnosis attached to each finding
 * @returns One finding per disagreement, empty when the two match
 */
export function auditPublishList(
  wouldPublish: readonly string[],
  intended: readonly string[],
  manifests: readonly WorkspaceManifest[],
): GateFinding[] {
  const findings: GateFinding[] = [];

  // A DRY RUN THAT PRODUCED NOTHING IS NOT AN EMPTY INTENDED SET, and the two look identical to a
  // set comparison. Say which happened.
  if (wouldPublish.length === 0) {
    findings.push({
      level: 'error',
      message:
        'the publish dry run named no package at all, so nothing was compared. A run that read nothing reports what a clean one does',
    });

    return findings;
  }

  const intendedSet = new Set(intended);
  const wouldSet = new Set(wouldPublish);
  const byName = new Map(manifests.map((manifest) => [manifest.name, manifest]));

  const unexpected = wouldPublish.filter((name) => !intendedSet.has(name));
  const missing = intended.filter((name) => !wouldSet.has(name));

  // Reported first and on its own: this is the failure BUILD.md T064 names by hand, and a reader
  // who sees one line about a set difference does not necessarily read it as "an internal package
  // is about to be published".
  for (const name of unexpected) {
    const manifest = byName.get(name);
    const diagnosis =
      manifest === undefined
        ? 'It is not a workspace package at all, so the dry run read something this gate cannot see'
        : manifest.isPrivate
          ? `Its manifest at ${manifest.directory} does set private: true, so pnpm emitted a package its own rule says it would skip`
          : `Its manifest at ${manifest.directory} does not set private: true, which is the only thing that would have kept it in`;

    findings.push({
      level: 'error',
      message: `${name} is internal by the intended set and the publish dry run would publish it. ${diagnosis}. Publishing is a product decision: add it to SPEC 4, to CLAUDE.md and to PUBLISHED_PACKAGES, or mark the package private`,
    });
  }

  for (const name of missing) {
    const manifest = byName.get(name);
    const diagnosis =
      manifest === undefined
        ? ' It is not a workspace package, so no manifest could have offered it'
        : manifest.isPrivate
          ? ` Its manifest at ${manifest.directory} sets private: true, so pnpm will never publish it`
          : '';

    findings.push({
      level: 'error',
      message: `${name} is in the intended set and the publish dry run would not publish it.${diagnosis}`,
    });
  }

  if (findings.length === 0) {
    findings.push({
      level: 'info',
      message: `the publish dry run names exactly the ${String(intended.length)} intended packages`,
    });
  }

  return findings;
}

/**
 * Holds the intended set against the lists one document states by hand.
 *
 * IT IS CALLED ONCE PER DOCUMENT THAT STATES THE SET, and since the post T064 review that is two:
 * SPEC 4 and `CLAUDE.md`. The label is a parameter so a failure names the file a reader has to
 * open, because "the published table disagrees" is useless when four of them exist.
 *
 * @param intended - The committed intended set
 * @param lists - What the document says
 * @param document - The document's name, for the message
 * @returns One finding per disagreement, empty when they match
 */
export function auditSpecAgreement(
  intended: readonly string[],
  lists: SpecPackageLists,
  document = 'SPEC 4',
): GateFinding[] {
  const findings: GateFinding[] = [];

  if (lists.published.length === 0) {
    findings.push({
      level: 'error',
      message: `${document} published table was not found or held no package name, so nothing was compared against it`,
    });

    return findings;
  }

  const fromSpec = [...new Set([...lists.published, ...lists.ecosystem])].sort();
  const intendedSorted = [...intended].sort();

  for (const name of fromSpec.filter((name) => !intendedSorted.includes(name))) {
    findings.push({
      level: 'error',
      message: `${document} lists ${name} as published and PUBLISHED_PACKAGES does not`,
    });
  }

  for (const name of intendedSorted.filter((name) => !fromSpec.includes(name))) {
    findings.push({
      level: 'error',
      message: `PUBLISHED_PACKAGES names ${name} and ${document} lists it nowhere as published`,
    });
  }

  for (const name of lists.internal.filter((name) => intendedSorted.includes(name))) {
    findings.push({
      level: 'error',
      message: `${name} is in ${document}'s internal list and in the intended published set at once`,
    });
  }

  if (findings.length === 0) {
    findings.push({
      level: 'info',
      message: `${document} and PUBLISHED_PACKAGES agree on ${String(fromSpec.length)} names, ${String(lists.internal.length)} internal`,
    });
  }

  return findings;
}

/** A registry entry: a package that would be published but for a named reason. */
export interface HeldBackEntry {
  readonly name: string;
  readonly reason: string;
  readonly until: string;
}

/** One document's name and the held back list it states, for a failure a reader can act on. */
export interface HeldBackStatement {
  readonly document: string;
  readonly names: readonly string[];
}

/**
 * Holds the held back registry against the manifests, the intended set and the documents.
 *
 * IT ANSWERS THE ONE QUESTION A SET DIFFERENCE CANNOT ASK. Every other audit in this file compares
 * two statements of what goes out. None of them can tell a package that is absent on purpose from a
 * package that is absent because somebody forgot, and that difference is the whole of a publish list
 * being a promise rather than a list. `@openref/nuxt` was absent from the published table for a
 * measured licence reason recorded only in prose, and prose is exactly what the ninth defect class
 * of SPEC 0 says a task can close over without answering.
 *
 * FIVE CHECKS, EACH BECAUSE IT FAILS ON ITS OWN. A held back name has to be a workspace package, or
 * the entry governs nothing. It has to be `private`, or the dry run publishes it whatever this list
 * says. It has to be out of the intended set, or two lists give two answers to one question. It has
 * to be out of what the dry run would emit, which is the same question asked of the command a
 * release runs rather than of the marking. And each document that states the package lists has to
 * name it, in both directions, because a registry entry no document carries is invisible to a
 * reader and a document entry no registry carries is unenforced.
 *
 * NOTHING HERE LOOSENS THE FOUR LISTS IT SITS BESIDE. A held back package is still absent from the
 * published table, still absent from `PUBLISHED_PACKAGES`, still absent from the dry run, and this
 * audit fails if any of those three stops being true.
 *
 * @param heldBack - The committed registry
 * @param intended - The committed intended published set
 * @param wouldPublish - Names read from the dry run
 * @param manifests - Every workspace manifest
 * @param statements - One entry per document that states the lists by hand
 * @returns One finding per disagreement, and an info line when the registry is consistent
 */
export function auditHeldBack(
  heldBack: readonly HeldBackEntry[],
  intended: readonly string[],
  wouldPublish: readonly string[],
  manifests: readonly WorkspaceManifest[],
  statements: readonly HeldBackStatement[],
): GateFinding[] {
  const findings: GateFinding[] = [];
  const byName = new Map(manifests.map((manifest) => [manifest.name, manifest]));
  const registry = heldBack.map((entry) => entry.name).sort();
  const intendedSet = new Set(intended);
  const wouldSet = new Set(wouldPublish);

  for (const entry of heldBack) {
    const manifest = byName.get(entry.name);

    if (manifest === undefined) {
      findings.push({
        level: 'error',
        message: `${entry.name} is held back and this workspace has no such package, so the entry governs nothing and reads as cover`,
      });
      continue;
    }

    if (!manifest.isPrivate) {
      findings.push({
        level: 'error',
        message: `${entry.name} is held back and its manifest at ${manifest.directory} does not set private: true, so a release publishes it whatever this list says`,
      });
    }

    if (intendedSet.has(entry.name)) {
      findings.push({
        level: 'error',
        message: `${entry.name} is held back and is also in the intended published set, which is two answers to one question`,
      });
    }

    if (wouldSet.has(entry.name)) {
      findings.push({
        level: 'error',
        message: `${entry.name} is held back and the publish dry run would publish it, so the record is a statement about the tree that the tree contradicts`,
      });
    }

    if (entry.reason.trim() === '' || entry.until.trim() === '') {
      findings.push({
        level: 'error',
        message: `${entry.name} is held back with no reason or no release named, and an entry that says only "not yet" is the absence it was written to replace`,
      });
    }
  }

  for (const statement of statements) {
    const stated = [...statement.names].sort();

    for (const name of stated.filter((name) => !registry.includes(name))) {
      findings.push({
        level: 'error',
        message: `${statement.document} names ${name} as held back and HELD_BACK_PACKAGES does not, so nothing enforces it`,
      });
    }

    for (const name of registry.filter((name) => !stated.includes(name))) {
      findings.push({
        level: 'error',
        message: `HELD_BACK_PACKAGES holds ${name} back and ${statement.document} does not say so, so a reader of that document meets the absence with no reason beside it`,
      });
    }
  }

  if (findings.length === 0) {
    findings.push({
      level: 'info',
      message:
        registry.length === 0
          ? `no package is held back, and ${String(statements.length)} document(s) agree`
          : `${String(registry.length)} package(s) held back from the publish list, each private, out of the intended set, out of the dry run, and stated in ${String(statements.length)} document(s): ${heldBack.map((entry) => `${entry.name} until ${entry.until}`).join('; ')}`,
    });
  }

  return findings;
}

/** The one field of `.changeset/config.json` this gate has an opinion about. */
interface ChangesetConfig {
  readonly fixed?: readonly (readonly string[])[];
}

/**
 * Holds the changeset fixed groups against the set the release actually publishes.
 *
 * NOTHING READ THIS FILE UNTIL THE POST T064 REVIEW, and it had drifted the same way every other
 * hand written copy of this list drifted. Its one group named five published packages and
 * `@openref/action`, which is private and versioned in lockstep with the CLI on purpose, and it
 * omitted `@openref/theme-telltale`, published since T032, and `@openref/runner` and
 * `@openref/theme-kit`, published at T064. A package outside every group takes its own version, so
 * the group is what decides whether one tag means one version, and a silent omission is a package
 * quietly leaving lockstep.
 *
 * THE RULE IS THE SPEC 4 TABLE RATHER THAN THE WHOLE INTENDED SET. The three ecosystem collectors
 * are published and are deliberately not in the table: SPEC 4 keeps them as separate packages with
 * their own cadence, so they may be in a group or out of one. What may not happen is a name in the
 * table missing from every group, or a group naming something this workspace does not have.
 *
 * @param config - Parsed `.changeset/config.json`
 * @param table - The published table of SPEC 4, which is the set that versions in lockstep
 * @param manifests - Every workspace manifest, so a stale name is caught
 * @returns One finding per disagreement, empty when the groups are complete
 */
export function auditChangesetGroups(
  config: ChangesetConfig,
  table: readonly string[],
  manifests: readonly WorkspaceManifest[],
): GateFinding[] {
  const findings: GateFinding[] = [];
  const groups = config.fixed ?? [];
  const grouped = new Set(groups.flat());
  const workspaceNames = new Set(manifests.map((manifest) => manifest.name));

  if (table.length === 0) {
    findings.push({
      level: 'error',
      message:
        'the published table held no name, so the changeset fixed groups were compared against nothing',
    });

    return findings;
  }

  for (const name of table.filter((name) => !grouped.has(name))) {
    findings.push({
      level: 'error',
      message: `${name} is in the published table and in no fixed group of .changeset/config.json, so it would take a version of its own rather than the one the tag names`,
    });
  }

  for (const name of [...grouped].sort().filter((name) => !workspaceNames.has(name))) {
    findings.push({
      level: 'error',
      message: `.changeset/config.json puts ${name} in a fixed group and this workspace has no such package, so the entry governs nothing`,
    });
  }

  if (findings.length === 0) {
    findings.push({
      level: 'info',
      message: `.changeset/config.json versions ${String(grouped.size)} packages in lockstep, covering all ${String(table.length)} of the published table`,
    });
  }

  return findings;
}

/**
 * A dependency record as an object, whatever the manifest actually held there.
 *
 * @param value - The raw field
 * @returns The record, empty when the field is absent or is not an object
 */
function dependenciesOf(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null
    ? (value as Readonly<Record<string, unknown>>)
    : {};
}

/**
 * Checks that every published package carries what a published package is obliged to carry.
 *
 * THE LICENCE IS COMPARED BY DIGEST RATHER THAN BY PRESENCE. A file called LICENSE holding a
 * different licence, or a pointer to the repository, would pass a presence check and discharge
 * nothing: a reader who installed one package never sees the repository. That is the same
 * argument zone 4 makes about a font's licence text, applied to our own.
 *
 * THE REPOSITORY IS THE ONE THIS BUILD RUNS IN, DERIVED, NOT A LITERAL. npm attaches a provenance
 * statement to each publish and attests it against the repository the workflow ran in, so a
 * manifest naming any other address does not publish unattested, it is refused. A constant holding
 * the expected address is therefore a second copy of a fact the checkout already carries, and the
 * two had drifted apart in exactly the way two copies do: the manifests said `openref-dev/openref`,
 * this file's constant said `openref/openref`, and nothing could say which was wrong because
 * nothing had read `git remote`. Reading it is what holds them together now, and there is no
 * second copy left for a manifest to disagree with.
 *
 * @param repoRoot - Absolute repository root
 * @param manifests - Every workspace manifest
 * @param intended - The names that will be published
 * @param repository - The repository this build runs in, from {@link resolveBuildRepository}
 * @returns One finding per package that is missing something, empty when all are complete
 */
export function auditPublishedDelivery(
  repoRoot: string,
  manifests: readonly WorkspaceManifest[],
  intended: readonly string[],
  repository: BuildRepository,
): GateFinding[] {
  const findings: GateFinding[] = [];
  const digestOf = (path: string): string | null => {
    try {
      return createHash('sha256').update(readFileSync(path)).digest('hex');
    } catch {
      return null;
    }
  };

  const canonical = digestOf(join(repoRoot, 'LICENSE'));
  if (canonical === null) {
    findings.push({
      level: 'error',
      message:
        'the repository root has no LICENSE, so there is nothing to compare a package licence against',
    });

    return findings;
  }

  // A NULL SLUG IS AN ERROR AND NOT A PASSED CHECK. Everything below still runs, because a licence
  // and an access setting need no remote, and the one question that does need it says so rather
  // than reading as clean.
  const expectedRepository = repository.slug === null ? null : repositoryUrlOf(repository.slug);
  if (expectedRepository === null) {
    findings.push({
      level: 'error',
      message: `the repository this build runs in could not be read, because ${repository.source}, so no manifest's repository field was compared against anything. npm attests provenance against the building repository, so a release from here would be attested against an address nothing checked`,
    });
  }

  const byName = new Map(manifests.map((manifest) => [manifest.name, manifest]));
  let checked = 0;

  for (const name of intended) {
    const manifest = byName.get(name);
    if (manifest === undefined) {
      findings.push({
        level: 'error',
        message: `${name} is in the intended published set and is not a workspace package`,
      });
      continue;
    }

    checked += 1;
    const directory = join(repoRoot, manifest.directory);
    const licence = digestOf(join(directory, 'LICENSE'));

    if (licence === null) {
      findings.push({
        level: 'error',
        message: `${name} declares a licence in its manifest and ships no LICENSE file. SPEC 0: the text travels with the files`,
      });
    } else if (licence !== canonical) {
      findings.push({
        level: 'error',
        message: `${name} ships a LICENSE that is not the repository's own text`,
      });
    }

    const raw = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as {
      readonly license?: unknown;
      readonly repository?: { readonly url?: unknown };
      readonly bugs?: { readonly url?: unknown };
      readonly publishConfig?: { readonly access?: unknown };
      readonly dependencies?: unknown;
      readonly peerDependencies?: unknown;
      readonly optionalDependencies?: unknown;
    };

    if (raw.license !== 'MIT') {
      findings.push({ level: 'error', message: `${name} does not declare MIT, per SPEC 0` });
    }

    // A PRIVATE WORKSPACE PACKAGE NAMED AS AN INSTALL EDGE IS AN INSTALL THAT FAILS, and it is not
    // a subtle failure: the name is on no registry, so `npm install` stops before a line of the
    // package runs. Found at the post T064 review on `openref`, which declared `@openref/render`,
    // `@openref/search` and `@openref/static` as `dependencies` while all three were private and
    // two of them were not even bundled in. Every other check this gate makes passed on it, because
    // they ask what a package carries rather than what it asks for.
    //
    // THE ANSWER IS ALWAYS TO BUNDLE, NEVER TO PUBLISH THE EDGE. SPEC 4's rule runs the other way:
    // an internal package is inlined into the published one and sits in `devDependencies` for that
    // reason, so its third party dependencies become the published package's own.
    const edges = [
      ...Object.keys(dependenciesOf(raw.dependencies)),
      ...Object.keys(dependenciesOf(raw.peerDependencies)),
      ...Object.keys(dependenciesOf(raw.optionalDependencies)),
    ];

    for (const edge of edges.filter((edge) => byName.get(edge)?.isPrivate === true)) {
      findings.push({
        level: 'error',
        message: `${name} declares ${edge} as an install edge and ${edge} is a private workspace package, so it is on no registry and the install fails before anything runs. Bundle it and move it to devDependencies, per SPEC 4`,
      });
    }

    // Provenance is attested against the repository the manifest names. Without the field npm
    // refuses the publish outright, so an absent one turns the release red at the last step
    // rather than here.
    if (expectedRepository !== null && raw.repository?.url !== expectedRepository) {
      findings.push({
        level: 'error',
        message: `${name} names ${typeof raw.repository?.url === 'string' ? raw.repository.url : 'no repository at all'} and this build runs in ${repository.slug ?? ''}, read from ${repository.source}. npm attests provenance against the building repository, so the publish would be refused. The manifest has to say ${expectedRepository}`,
      });
    }

    // THE ISSUES ADDRESS CARRIES THE SAME SLUG AND WOULD DRIFT THE SAME WAY, one release later and
    // more quietly: a wrong repository field refuses the publish, a wrong bugs field ships and
    // sends every reader who hits a defect to somebody else's tracker.
    if (
      repository.slug !== null &&
      raw.bugs?.url !== `https://github.com/${repository.slug}/issues`
    ) {
      findings.push({
        level: 'error',
        message: `${name} points bugs.url at ${typeof raw.bugs?.url === 'string' ? raw.bugs.url : 'nothing'} and this build runs in ${repository.slug}, so an installed package would send its readers somewhere else`,
      });
    }

    if (name.startsWith('@') && raw.publishConfig?.access !== PROVENANCE_REQUIREMENT.access) {
      findings.push({
        level: 'error',
        message: `${name} is scoped and does not set publishConfig.access to ${PROVENANCE_REQUIREMENT.access}, so its first publish would be private`,
      });
    }
  }

  if (checked === 0) {
    findings.push({
      level: 'error',
      message: 'no published package was checked for delivery, so nothing was proved',
    });
  } else if (findings.length === 0) {
    findings.push({
      level: 'info',
      message: `${String(checked)} published packages carry the licence text, a public access setting, and a repository field naming ${repository.slug ?? ''}, which is where this build runs, read from ${repository.source}`,
    });
  }

  return findings;
}
