import {
  PRIVATE_DOCS_MIN_FILES,
  PRIVATE_DOC_EXEMPTIONS,
  scanTrackedForPrivateDocs,
} from '../lib/private-docs.js';
import type { Gate, GateFinding, GateResult } from '../types.js';

/**
 * No tracked file sends a reader to a document a clone does not have.
 *
 * WHAT WENT WRONG BEFORE THIS EXISTED. The maintainer's private documents were correctly kept
 * out of git, and 295 references to them were not. Comments, a shipped public API table and the
 * root third party notices all cited files that exist on exactly one machine. Every one of those
 * citations read as an authority a reader could go and check, and for every reader but one it was
 * a dead end. The specification being private is a decision; the citations being unfollowable was
 * an accident nobody could see, because on the machine that wrote them every link resolved.
 *
 * IT READS THE TRACKED SET FROM GIT RATHER THAN WALKING THE FILESYSTEM, and that is the exact
 * distinction the leak was made of. A walk over the working tree sees the private documents on
 * the maintainer's machine and not on a clone, so it answers a different question for each
 * reader. `git ls-files` answers the only question that matters here: what does somebody who
 * clones this repository actually receive.
 *
 * THE EXEMPTIONS ARE PATHS AND NOT PATTERNS. A file whose subject is those documents has to name
 * them, and a glob over the gates directory would have covered every one of them and also covered
 * the next stray citation written there. Each exemption is one path with one sentence saying why,
 * and the gate fails when an exemption stops covering anything, so the list cannot rot into a
 * standing permission.
 */
export const privateDocsGate: Gate = {
  id: 'private-docs',
  title: 'No tracked file cites a document that is not in the repository',

  run(context): Promise<GateResult> {
    const scan = scanTrackedForPrivateDocs(context.repoRoot);
    const findings: GateFinding[] = [];

    if (scan.error !== undefined) {
      findings.push({
        level: 'error',
        message:
          `the tracked set could not be read, so nothing was checked: ${scan.error}. ` +
          'This gate reads `git ls-files` on purpose and has no filesystem fallback, because a ' +
          'walk reports a different repository depending on who runs it',
      });

      return Promise.resolve({
        id: privateDocsGate.id,
        title: privateDocsGate.title,
        status: 'fail',
        findings,
      });
    }

    for (const hit of scan.hits) {
      findings.push({
        level: 'error',
        message:
          `${hit.path}:${String(hit.line)}:${String(hit.column)} names \`${hit.token}\`, which ` +
          'no clone contains: ' +
          `"${hit.text.slice(0, 120)}". Keep the justification and drop the pointer. Either ` +
          'cite something a cloner has, or state the argument itself, which is usually the ' +
          'better comment. Never delete the reason in order to delete the reference',
      });
    }

    for (const exemption of scan.staleExemptions) {
      findings.push({
        level: 'error',
        message:
          `${exemption.file} is on the exemption list and no longer names either document, so ` +
          'the entry now pre-authorizes a reference nobody has reviewed. Remove the entry in ' +
          `the same commit as the reference it covered. It was allowed because it ${exemption.reason}`,
      });
    }

    for (const exemption of scan.untrackedExemptions) {
      findings.push({
        level: 'error',
        message:
          `${exemption.file} is on the exemption list and git does not track it, so the entry ` +
          'covers nothing and hides nothing. Remove it',
      });
    }

    findings.push({
      level: 'info',
      message:
        `read ${String(scan.scanned)} tracked file(s) from \`git ls-files\`, with ` +
        `${String(PRIVATE_DOC_EXEMPTIONS.length)} exemption(s) enumerated by path`,
    });

    if (scan.scanned < PRIVATE_DOCS_MIN_FILES) {
      findings.push({
        level: 'error',
        message:
          `only ${String(scan.scanned)} tracked file(s) were read, below the floor of ` +
          `${String(PRIVATE_DOCS_MIN_FILES)}. A reading that small found nothing because it ` +
          'looked at nothing, and that is not the same as a repository with no references',
      });
    }

    const failed = findings.some((finding) => finding.level === 'error');

    if (!failed) {
      findings.push({
        level: 'info',
        message:
          `${String(scan.scanned)} tracked file(s) carry no reference to the maintainer's ` +
          'private documents, so every citation a cloner can read points at something a clone ' +
          'contains',
      });
    }

    return Promise.resolve({
      id: privateDocsGate.id,
      title: privateDocsGate.title,
      status: failed ? 'fail' : 'pass',
      findings,
    });
  },
};
