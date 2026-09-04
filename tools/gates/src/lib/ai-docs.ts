/**
 * Whether the maintainer's private documents are on this machine at all.
 *
 * `ai-docs/` is excluded from git in `.git/info/exclude`, so no clone restores it and no runner
 * has it. TWELVE GATES ONCE SKIPPED FOR THAT AND NONE OF THEM DOES NOW: what each of them needed
 * out of those documents is generated into `tools/gates/ai-docs-projection.json`, which is
 * committed, and every one of them reads the artefact. See `lib/projection.ts` for what ships and
 * what does not.
 *
 * WHAT THIS IS STILL FOR, AND IT IS TWO THINGS. `build-manifest` regenerates the projection
 * wherever the documents are and fails when the committed artefact no longer agrees with them,
 * which is the check that keeps the artefact honest and can only run here. And two gates still
 * read a document directly and skip without it, both conditionally: `budget-exceptions` needs the
 * plan only when the exception list is not empty, and `coverage` reconciles the STANDARDS 9.1
 * table it cannot see on a clone while enforcing every floor there regardless.
 *
 * A SKIP, NOT A PASS, AND NEVER A SILENT ONE, for those two. The gate returns `skip`, the summary
 * prints SKIP beside its name, and the message says what was not checked and why. A gate that
 * quietly returned `pass` with nothing read would be the failure this repository keeps removing:
 * an absence that reads as coverage.
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
 * How many places still print {@link aiDocsAbsentMessage}.
 *
 * IT IS A COUNT OF SOMETHING IN THIS REPOSITORY AND IT IS CHECKED RATHER THAN ASSERTED. The
 * sentence this replaces said "one call site left of the four it was written for", and neither
 * figure was ever taken: the committed tree carries nine calls across eight gates, and the slice
 * that removed eight of them wrote its own number beside the four rather than counting. Measured
 * with `git grep -o "aiDocsAbsentMessage(" HEAD -- tools/gates/src`, which answers ten including
 * the definition below. `projection.spec.ts` counts the calls in the working tree and holds them to
 * this, so a gate that starts or stops printing the message moves the number or goes red.
 */
export const AI_DOCS_ABSENT_CALL_SITES = 1;

/**
 * The message a gate prints when it checked nothing because the directory is not there.
 *
 * {@link AI_DOCS_ABSENT_CALL_SITES} places print it, and the text stays shared because the next
 * gate that has to read a document rather than a projection of one will want to say the same
 * thing in the same words.
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
    `checkout without it is expected rather than broken. What the twelve gates that used to say ` +
    `this do instead is read tools/gates/ai-docs-projection.json, which is generated from these ` +
    `documents and committed; this reading is not in it yet.`
  );
}

function defaultIsDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
