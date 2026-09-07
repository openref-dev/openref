import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { runCommand } from './exec.js';

/**
 * Whether a tracked file points a reader at a document no clone contains.
 *
 * THE TWO DOCUMENTS ARE NOT IN THE REPOSITORY AND THAT IS DELIBERATE. `ai-docs/` holds the
 * maintainer's private working documents and `CLAUDE.md` holds the working instructions. Both
 * are excluded in `.git/info/exclude`, `git ls-files` returns nothing for either, and a clone
 * is expected to have neither. Nothing here changes that and nothing here reads them.
 *
 * THE LEAK IS THE OTHER DIRECTION. A tracked comment that ends "per `ai-docs/SPEC.md` section 0"
 * or "per CLAUDE.md rule 5" sends every reader who ever clones this repository to a file they
 * cannot open, and a citation that cannot be followed is worse than no citation at all: it reads
 * as though the reasoning lives somewhere authoritative when in fact the reasoning has been lost.
 * The rule is that the justification stays in the comment and the pointer goes.
 *
 * IT READS THE TRACKED SET FROM GIT AND NEVER WALKS THE FILESYSTEM. That distinction is the
 * whole subject. A walk finds `ai-docs/SPEC.md` on the maintainer's machine and finds nothing on
 * a clone, so a walking check reports a different repository depending on who runs it, and the
 * one it reports clean is the one that still has the private documents to hide. `git ls-files`
 * returns the same set everywhere, which is the only set a reader of this repository can have.
 */

/**
 * The token spellings that name a document no clone has.
 *
 * THE TWO GUARDS ARE BOTH ABOUT NOT FLAGGING SOMETHING A READER CAN FOLLOW. The trailing guard
 * spares `ai-docs-projection.json`, the committed artefact, which is tracked and is the whole
 * point of the arrangement. The leading guard spares `src/lib/ai-docs.ts` and every import of
 * it: a module path that resolves to a tracked file is not a dangling pointer, and requiring an
 * exemption for each importer would grow the allowlist for references that were never the
 * problem. What both guards keep is the form the leak actually takes, which is the directory
 * named at the repository root: `ai-docs/SPEC.md`, or bare `ai-docs` in prose.
 */
const AI_DOCS_PATTERN = /(?<![\w/-])ai-docs(?![\w-])/g;
const CLAUDE_PATTERN = /CLAUDE\.md/g;

/**
 * Fewest tracked files this scan must read before its silence means anything.
 *
 * A `git ls-files` that returns nothing, a wrong working directory or a git that is not on the
 * path all produce an empty reading, and an empty reading finds no references at all. Without a
 * floor that outcome is indistinguishable from a clean repository, which is a proof of absence
 * that never established its subject was present.
 */
export const PRIVATE_DOCS_MIN_FILES = 400;

/** One place a tracked file names a document no clone has. */
export interface PrivateDocHit {
  readonly path: string;
  readonly line: number;
  readonly column: number;
  readonly token: string;
  readonly text: string;
}

/** A tracked file allowed to name the private documents, and why. */
export interface PrivateDocExemption {
  readonly file: string;
  readonly reason: string;
}

/** Outcome of reading every tracked file. */
export interface PrivateDocScan {
  readonly scanned: number;
  readonly hits: readonly PrivateDocHit[];
  readonly staleExemptions: readonly PrivateDocExemption[];
  readonly untrackedExemptions: readonly PrivateDocExemption[];
  readonly error?: string;
}

/**
 * The tracked files allowed to name the private documents, each with the reason it is allowed.
 *
 * EVERY ENTRY IS A PATH AND NOT A PATTERN, deliberately. `tools/gates/**` would fit every entry
 * below and would also silently cover the next gate that cites a private document out of habit,
 * which is the failure this whole gate exists to catch. A new exemption is a line in this table
 * and a sentence saying why, which is a thing a reviewer can disagree with.
 *
 * THE REASON IS ALWAYS THE SAME SHAPE: the file's subject IS one of those documents. It reads
 * them, projects them, records what they said for a machine that lacks them, or reports that
 * they are absent. Naming a file you are reading is not a dangling pointer. Citing one to
 * justify an unrelated decision is, and no entry below does that.
 */
export const PRIVATE_DOC_EXEMPTIONS: readonly PrivateDocExemption[] = [
  {
    file: '.prettierignore',
    reason:
      'names both documents so prettier never rewrites them. This is the mechanism that keeps ' +
      'them private and out of the formatter, not a citation of them',
  },
  {
    file: '.github/workflows/runner-column-study.yml',
    reason:
      'probes the runner checkout for that directory, so the study records whether the private ' +
      'documents were present on the machine it measured',
  },
  {
    file: 'packages/core/test/unit/rule-codes.spec.ts',
    reason:
      'reads the specification table off disk when it is there and skips when it is not, so the ' +
      'path is an input it resolves rather than a pointer it hands a reader',
  },
  {
    file: 'packages/theme-telltale/test/integration/theme-boundary.spec.ts',
    reason:
      'adds the specification as a third document when the checkout has it, covering two of ' +
      'three without it, so the path is an input it resolves rather than a citation',
  },
  {
    file: 'tools/gates/README.md',
    reason:
      'documents how the gates behave when the private documents are absent, which is the ' +
      'question a cloner actually needs answered',
  },
  {
    file: 'tools/gates/ai-docs-projection.json',
    reason:
      'is the committed projection: the reading of the private documents that travels to ' +
      'machines without them. Its keys are those documents by name because they are its subject',
  },
  {
    file: 'tools/gates/src/config.ts',
    reason: 'holds the path constants every reader of those documents resolves',
  },
  {
    file: 'tools/gates/src/lib/private-docs.ts',
    reason: 'defines the token spellings this gate searches for, so it necessarily contains them',
  },
  {
    file: 'tools/gates/test/unit/private-docs.spec.ts',
    reason: 'plants both spellings on a synthetic tree to prove this gate can go red',
  },
  {
    file: 'tools/gates/src/lib/ai-docs.ts',
    reason: 'reads the private documents from disk when they are present',
  },
  {
    file: 'tools/gates/src/lib/projection.ts',
    reason: 'builds the committed projection out of those documents',
  },
  {
    file: 'tools/gates/src/projection.ts',
    reason: 'is the command that writes the projection',
  },
  {
    file: 'tools/gates/src/lib/projected-spec.ts',
    reason: 'reads the projection and says which document a value came from',
  },
  {
    file: 'tools/gates/src/lib/projection-prose.ts',
    reason: 'scans the projection for prose that must not leave those documents',
  },
  {
    file: 'tools/gates/src/lib/projection-request.ts',
    reason: 'names which parts of those documents the projection asks for',
  },
  {
    file: 'tools/gates/src/gates/projection-privacy.gate.ts',
    reason: 'exists to prove the projection leaks no sentence of those documents',
  },
  {
    file: 'tools/gates/src/lib/build-manifest.ts',
    reason: 'reads the build order and its amendments out of those documents',
  },
  {
    file: 'tools/gates/src/gates/build-manifest.gate.ts',
    reason: 'compares the committed projection against those documents when they are present',
  },
  {
    file: 'tools/gates/src/lib/claims.ts',
    reason: 'resolves a claim to the specification section that makes it',
  },
  {
    file: 'tools/gates/src/gates/claims.gate.ts',
    reason: 'checks claims against the specification section they name',
  },
  {
    file: 'tools/gates/src/lib/deferrals.ts',
    reason: 'reads deferral markers out of the documents that carry them',
  },
  {
    file: 'tools/gates/src/gates/deferrals.gate.ts',
    reason: 'reports deferral markers found in those documents',
  },
  {
    file: 'tools/gates/src/lib/publish-list.ts',
    reason: 'reads the published package tables out of the private instructions file',
  },
  {
    file: 'tools/gates/src/gates/publish-list.gate.ts',
    reason: 'reports that the instructions file is absent rather than failing a clone',
  },
  {
    file: 'tools/gates/src/lib/skip-accounting.ts',
    reason: 'records whether the private documents are in this checkout, which is its whole job',
  },
  {
    file: 'tools/gates/src/lib/conditional-cases.ts',
    reason: 'probes for the specification file to decide which half of a check can run',
  },
  {
    file: 'tools/gates/src/lib/coverage.ts',
    reason: 'takes the standards document text as a parameter when it is present',
  },
  {
    file: 'tools/gates/src/gates/coverage.gate.ts',
    reason: 'explains which half of the coverage check survives without those documents',
  },
  {
    file: 'tools/gates/src/lib/static-suites.ts',
    reason: 'takes the specification text as a parameter when it is present',
  },
  {
    file: 'tools/gates/src/gates/static-suites.gate.ts',
    reason: 'explains which half of the suite check needs those documents',
  },
  {
    file: 'tools/gates/src/gates/events-suites.gate.ts',
    reason: 'explains which half of the suite check needs those documents',
  },
  {
    file: 'tools/gates/src/gates/federation-suites.gate.ts',
    reason: 'explains which half of the suite check needs those documents',
  },
  {
    file: 'tools/gates/src/gates/m7-suites.gate.ts',
    reason: 'reads the amendment sections that keep a task from being ticked',
  },
  {
    file: 'tools/gates/src/lib/reader-pages.ts',
    reason: 'takes the specification text as a parameter when it is present',
  },
  {
    file: 'tools/gates/src/gates/reader-pages.gate.ts',
    reason: 'explains why the reader pages travel through the projection instead',
  },
  {
    file: 'tools/gates/src/gates/budget-exceptions.gate.ts',
    reason: 'reports which budget exceptions it could not check without those documents',
  },
  {
    file: 'tools/gates/src/gates/capability-debts.gate.ts',
    reason: 'records that it no longer needs those documents, which is the fact worth keeping',
  },
  {
    file: 'tools/gates/src/gates/theme-motion.gate.ts',
    reason: 'explains that two of the three themes reach it through the projection',
  },
  {
    file: 'tools/gates/src/lib/text-source.ts',
    reason: 'records where a measured rate used to live before it was measured here',
  },
  {
    file: 'tools/gates/src/run.ts',
    reason: 'describes the gate that compares the projection with those documents',
  },
  {
    file: 'tools/gates/test/integration/gates.spec.ts',
    reason: 'asserts a gate warns rather than fails when the instructions file is absent',
  },
  {
    file: 'tools/gates/test/unit/projection.spec.ts',
    reason: 'asserts what the projection carries out of those documents',
  },
  {
    file: 'tools/gates/test/unit/build-manifest.spec.ts',
    reason: 'asserts the build order reader against those documents',
  },
  {
    file: 'tools/gates/test/unit/claims.spec.ts',
    reason: 'asserts the claim reader against the specification section it names',
  },
  {
    file: 'tools/gates/test/unit/deferrals.spec.ts',
    reason: 'asserts which documents deferral markers are read from',
  },
  {
    file: 'tools/gates/test/unit/publish-list.spec.ts',
    reason: 'asserts the published package tables are read from the instructions file',
  },
  {
    file: 'tools/gates/test/unit/format-allowlist.spec.ts',
    reason: 'asserts the formatter never reaches either private document',
  },
  {
    file: 'tools/gates/test/unit/text-source.spec.ts',
    reason: 'uses the instructions file as a real case of prose the text scan must accept',
  },
  {
    file: 'tools/gates/test/unit/skip-accounting.spec.ts',
    reason: 'asserts a skip names the absence of those documents as its cause',
  },
  {
    file: 'tools/gates/test/unit/coverage.spec.ts',
    reason: 'asserts the coverage reader against the standards document text',
  },
  {
    file: 'tools/gates/test/unit/browser-baseline.spec.ts',
    reason: 'reads the specification file directly when it is present',
  },
  {
    file: 'tools/gates/test/unit/reader-pages.spec.ts',
    reason: 'asserts the reader pages against the specification text',
  },
  {
    file: 'tools/gates/test/unit/m6-suites.spec.ts',
    reason: 'asserts a suite check against the specification text',
  },
  {
    file: 'tools/gates/test/unit/m7-suites.spec.ts',
    reason: 'asserts the amendment sections that keep a task from being ticked',
  },
  {
    file: 'tools/gates/test/unit/events-suites.spec.ts',
    reason: 'asserts a suite check against the specification text',
  },
  {
    file: 'tools/gates/test/unit/git.spec.ts',
    reason: 'commits a file under that directory on a synthetic tree to exercise a path filter',
  },
  {
    file: 'tools/gates/test/unit/capability-debts.spec.ts',
    reason:
      'creates and removes that directory on a synthetic tree, which is how it exercises both ' +
      'the present and the absent case',
  },
];

/** The exemption table keyed by path. */
const EXEMPT_BY_PATH = new Map(
  PRIVATE_DOC_EXEMPTIONS.map((exemption) => [exemption.file, exemption]),
);

/**
 * Lists the files git tracks, which is the set every clone has and nothing more.
 *
 * @param repoRoot - Absolute repository root
 * @returns Tracked paths relative to the root, or the reason git could not answer
 */
export function listTrackedFiles(repoRoot: string): {
  readonly files: readonly string[];
  readonly error?: string;
} {
  const result = runCommand('git', ['ls-files', '-z'], repoRoot);

  if (!result.ok) {
    return { files: [], error: `git ls-files failed: ${result.stderr.trim()}` };
  }

  const files = result.stdout.split('\0').filter((path) => path.length > 0);

  return { files };
}

/**
 * Finds every place a tracked file names a document no clone has.
 *
 * @param repoRoot - Absolute repository root
 * @param exemptions - The files allowed to name them, defaulting to the committed table
 * @returns The hits outside the exemption table, plus what the table itself no longer covers
 */
export function scanTrackedForPrivateDocs(
  repoRoot: string,
  exemptions: readonly PrivateDocExemption[] = PRIVATE_DOC_EXEMPTIONS,
): PrivateDocScan {
  const listing = listTrackedFiles(repoRoot);

  if (listing.error !== undefined) {
    return {
      scanned: 0,
      hits: [],
      staleExemptions: [],
      untrackedExemptions: [],
      error: listing.error,
    };
  }

  const exemptByPath = new Map(exemptions.map((exemption) => [exemption.file, exemption]));
  const tracked = new Set(listing.files);
  const hits: PrivateDocHit[] = [];
  const exemptionsThatMatched = new Set<string>();
  let scanned = 0;

  for (const path of listing.files) {
    let content: string;

    try {
      content = readFileSync(join(repoRoot, path), 'utf8');
    } catch {
      continue;
    }

    // A binary file has no lines a reader follows, and decoding one as text invents columns.
    if (content.includes('\0')) continue;

    scanned += 1;

    const found = findInText(path, content);

    if (found.length === 0) continue;

    if (exemptByPath.has(path)) {
      exemptionsThatMatched.add(path);
      continue;
    }

    hits.push(...found);
  }

  // AN EXEMPTION THAT COVERS NOTHING IS A HOLE WAITING FOR SOMETHING TO FALL IN IT. Once the
  // reference it was written for is gone, the line stays behind and silently pre-authorizes the
  // next one written into that same file, which nobody would have approved on its own.
  const staleExemptions = exemptions.filter(
    (exemption) => tracked.has(exemption.file) && !exemptionsThatMatched.has(exemption.file),
  );

  const untrackedExemptions = exemptions.filter((exemption) => !tracked.has(exemption.file));

  return { scanned, hits, staleExemptions, untrackedExemptions };
}

/**
 * Finds both token spellings in one file's text.
 *
 * @param path - Tracked path, used only to label a hit
 * @param content - The file's text
 * @returns Every occurrence, in reading order
 */
export function findInText(path: string, content: string): readonly PrivateDocHit[] {
  const hits: PrivateDocHit[] = [];
  const lines = content.split('\n');

  for (const [index, text] of lines.entries()) {
    for (const pattern of [AI_DOCS_PATTERN, CLAUDE_PATTERN]) {
      pattern.lastIndex = 0;

      let match = pattern.exec(text);

      while (match !== null) {
        hits.push({
          path,
          line: index + 1,
          column: match.index + 1,
          token: match[0],
          text: text.trim(),
        });

        match = pattern.exec(text);
      }
    }
  }

  return hits;
}

/**
 * Looks up why a file is allowed to name the private documents.
 *
 * @param path - Tracked path
 * @returns The recorded reason, or undefined when the file is not exempt
 */
export function exemptionReason(path: string): string | undefined {
  return EXEMPT_BY_PATH.get(path)?.reason;
}
