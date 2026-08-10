/**
 * Whether the documents three gates read are on this machine at all.
 *
 * `ai-docs/` is excluded from git in `.git/info/exclude`, so no clone restores it. Three gates
 * read files from it: `build-manifest` checks the four required documents and the BUILD.md line
 * addressing, `claims` reads the claim map and the specification the claims are taken out of,
 * and `theme-motion` reads three of its four themes from `ai-docs/design/`.
 *
 * ON A MACHINE THAT HAS THE DIRECTORY, NOTHING HERE CHANGES: every one of those checks runs and
 * fails exactly as before on a missing or empty file. What this decides is the other case, a
 * checkout with no `ai-docs/` at all, where the three gates would report the absence of the
 * maintainer's private documents as a defect in the code.
 *
 * A SKIP, NOT A PASS, AND NEVER A SILENT ONE. The gate returns `skip`, the summary prints SKIP
 * beside its name, and the message says what was not checked and why. A gate that quietly
 * returned `pass` with nothing read would be the failure this repository keeps removing: an
 * absence that reads as coverage.
 *
 * This is a holding position and it says so in its own message. How `ai-docs/` is versioned is
 * the maintainer's decision and it is not made here.
 */

import { statSync } from 'node:fs';
import { join } from 'node:path';

/** The directory the three document reading gates depend on. */
export const AI_DOCS_DIR = 'ai-docs';

/**
 * Reports whether `ai-docs/` is present as a directory.
 *
 * A file of that name counts as absent: it is not the directory the gates read from, and
 * treating it as present would produce a stack of unreadable-file errors instead of one clear
 * answer.
 *
 * @param repoRoot - Absolute repository root
 * @param stat - Directory test, injected so the two outcomes can be tested without a filesystem
 * @returns True when the directory is there
 */
export function aiDocsPresent(
  repoRoot: string,
  stat: (path: string) => boolean = defaultIsDirectory,
): boolean {
  return stat(join(repoRoot, AI_DOCS_DIR));
}

/**
 * The message a gate prints when it checked nothing because the directory is not there.
 *
 * One text, three call sites, so the three cannot drift into saying different things about the
 * same condition.
 *
 * @param gateTitle - What the gate would have checked
 * @param reads - The files or directories under `ai-docs/` this gate needs
 * @returns The finding message
 */
export function aiDocsAbsentMessage(gateTitle: string, reads: readonly string[]): string {
  return (
    `SKIPPED, NOT PASSED: ${AI_DOCS_DIR}/ is not present, so nothing was checked here. ` +
    `${gateTitle} reads ${reads.join(', ')}, and this run proves nothing about any of them. ` +
    `${AI_DOCS_DIR}/ is excluded from git in .git/info/exclude and no clone restores it, so a ` +
    `checkout without it is expected rather than broken. AWAITING THE MAINTAINER'S DECISION on ` +
    `how ${AI_DOCS_DIR}/ is versioned; until it is made, this gate can only run where the ` +
    `documents already are.`
  );
}

function defaultIsDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
