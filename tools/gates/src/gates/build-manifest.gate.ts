import {
  BUILD_AMENDMENTS_FILE,
  BUILD_FILE,
  BUILD_LINE_COUNT,
  BUILD_TASK_COUNT,
  REQUIRED_DOC_MIN_BYTES,
  REQUIRED_DOCS,
} from '../config.js';
import { aiDocsPresent } from '../lib/ai-docs.js';
import {
  checkAmendmentSections,
  checkBuildManifest,
  checkOwnedEntries,
  checkRequiredDocs,
  parseAmendmentSections,
  parseContents,
  parseMilestones,
  parseOwnedEntries,
  splitLines,
} from '../lib/build-manifest.js';
import {
  PROJECTION_COMMAND,
  PROJECTION_FILE,
  projectFromDisk,
  readProjection,
  staleSections,
} from '../lib/projection.js';
import { projectionRequest } from '../lib/projection-request.js';
import type { Gate, GateFinding, GateResult } from '../types.js';

/**
 * Verifies that the documents the project is written against are there, and that
 * `ai-docs/BUILD.md` still means what its CONTENTS ranges say.
 *
 * Runs before every other gate, and in that order within itself: a shifted BUILD.md means the
 * session read the wrong task, and a missing SPEC.md means it had nothing to read at all.
 * Either makes the rest of the run a report on the wrong work.
 *
 * IT READS THE COMMITTED PROJECTION AND NOT THE DOCUMENTS, since the artefact arrived. `ai-docs/`
 * is excluded from git and no clone restores it, so a gate that opened `BUILD.md` was a gate that
 * skipped on every CI run. What it opens now is `tools/gates/ai-docs-projection.json`, which
 * carries the line count, the CONTENTS ranges, the boxes and the heading positions with every
 * title replaced by a digest, and every check below runs over it unchanged.
 *
 * AND IT IS WHERE A STALE ARTEFACT GOES RED. This gate runs first, so it is the one that says the
 * reading the other eleven are about to trust is still the reading the documents give. Where
 * `ai-docs/` is present the projection is regenerated in memory and compared with the committed
 * one; a difference is an error naming the sections that moved and the command that fixes them.
 * Where `ai-docs/` is absent that comparison cannot be made by anybody, and the gate says which
 * question went unasked rather than passing on it, in a warning that does not colour the verdict:
 * the artefact's own integrity digest is checked on every checkout, so a hand edited artefact
 * fails everywhere, and only a document edited without regenerating needs the maintainer's tree.
 */
export const buildManifestGate: Gate = {
  id: 'build-manifest',
  title: 'Project documents and BUILD.md line addressing',

  run(context): Promise<GateResult> {
    const findings: GateFinding[] = [];
    let failed = false;

    const read = readProjection(context.repoRoot);

    if (!read.ok) {
      return Promise.resolve({
        id: buildManifestGate.id,
        title: buildManifestGate.title,
        status: 'fail',
        findings: [{ level: 'error', message: `[projection-unreadable] ${read.reason}` }],
      });
    }

    const projection = read.projection;

    // THE FRESHNESS QUESTION FIRST, because every finding below is a reading of this artefact and
    // a reader is owed the answer to "is this artefact what the documents say" before any of them.
    if (aiDocsPresent(context.repoRoot)) {
      const stale = staleSections(
        projection.data,
        projectFromDisk(context.repoRoot, projectionRequest()).data,
      );

      if (stale.length > 0) {
        failed = true;
        findings.push({
          level: 'error',
          message:
            `[projection-stale] ${PROJECTION_FILE} no longer says what ai-docs/ says. ` +
            `Section(s) that moved: ${stale.join(', ')}. A document changed and the artefact the ` +
            `gates read was not regenerated, so every check below is reporting on the previous ` +
            `reading. Run ${PROJECTION_COMMAND} and commit the result`,
        });
      } else {
        findings.push({
          level: 'info',
          message: `${PROJECTION_FILE} matches ai-docs/ as it stands on this machine`,
        });
      }
    } else {
      findings.push({
        level: 'warning',
        message:
          `ai-docs/ is not in this checkout, so ${PROJECTION_FILE} was not compared with the ` +
          `documents it is generated from and this run proves nothing about whether it is ` +
          `current. Its own integrity digest was checked and holds, so it is the artefact that ` +
          `was generated rather than one edited by hand; what is unanswered here is whether a ` +
          `document moved since. That question can only be asked where the documents are, and ` +
          `ai-docs/ is excluded from git in .git/info/exclude, so a checkout without it is ` +
          `expected rather than broken`,
      });
    }

    const sizes = new Map(projection.data.documents.map((doc) => [doc.file, doc.bytes]));

    const docs = checkRequiredDocs(
      REQUIRED_DOCS,
      REQUIRED_DOC_MIN_BYTES,
      (file) => sizes.get(file) ?? undefined,
    );

    for (const doc of docs) {
      if (doc.presence === 'missing') {
        failed = true;
        findings.push({
          level: 'error',
          message: `${doc.file} is missing. It is ${doc.purpose}, and it is outside the repository, so nothing restores it from a clone`,
        });
        continue;
      }

      if (doc.presence === 'empty') {
        failed = true;
        findings.push({
          level: 'error',
          message: `${doc.file} holds ${String(doc.bytes)} bytes, under the ${String(REQUIRED_DOC_MIN_BYTES)} a real document holds. A placeholder passes a presence check and carries nothing`,
        });
      }
    }

    if (!failed) {
      findings.push({
        level: 'info',
        message: `${String(docs.length)} project document(s) present: ${docs.map((doc) => doc.file).join(', ')}`,
      });
    }

    const text = projection.data.build;
    if (text === null) {
      findings.push({
        level: 'error',
        message: `${BUILD_FILE} was not readable when ${PROJECTION_FILE} was generated`,
      });
      return Promise.resolve({
        id: buildManifestGate.id,
        title: buildManifestGate.title,
        status: 'fail',
        findings,
      });
    }

    const issues = checkBuildManifest(text, BUILD_LINE_COUNT, BUILD_TASK_COUNT);

    for (const issue of issues) {
      failed = true;
      findings.push({ level: 'error', message: `[${issue.rule}] ${issue.message}` });
    }

    if (issues.length === 0) {
      findings.push({
        level: 'info',
        message: `${BUILD_FILE} intact: ${String(BUILD_LINE_COUNT)} lines, ${String(BUILD_TASK_COUNT)} tasks, every range on its own heading`,
      });
    }

    // AND WHETHER ANY TASK WAS TICKED OVER WORK ADDRESSED TO IT, per SPEC 0's ninth class. The two
    // files are read together here rather than by a gate of their own, because this is the same
    // question the checks above ask: whether the plan still says what the sessions read it as.
    const amendments = projection.data.amendments;
    if (amendments === null) {
      findings.push({
        level: 'error',
        message: `${BUILD_AMENDMENTS_FILE} was not readable when ${PROJECTION_FILE} was generated, so nothing is known about the work addressed to closed tasks`,
      });

      return Promise.resolve({
        id: buildManifestGate.id,
        title: buildManifestGate.title,
        status: 'fail',
        findings,
      });
    }

    const sections = parseAmendmentSections(splitLines(amendments));
    const sectionIssues = checkAmendmentSections(sections, parseContents(splitLines(text)));

    for (const issue of sectionIssues) {
      failed = true;
      findings.push({ level: 'error', message: `[${issue.rule}] ${issue.message}` });
    }

    if (sectionIssues.length === 0) {
      findings.push({
        level: 'info',
        message: `${String(sections.length)} per task amendment section(s) in ${BUILD_AMENDMENTS_FILE}, none of them open against a ticked task`,
      });
    }

    // AND WHETHER ANY RETROFIT OR TX ENTRY OUTLIVED ITS MILESTONE. Those entries are excluded
    // from the per task check above, correctly: they own work rather than adding it to a task,
    // so there is no tick for them to block. What that exclusion must not also mean is no expiry
    // at all, which is how TX-SERVED kept saying owner M1 after M1 closed. Every open entry
    // declares the milestone it closes inside, and the declaration is held to BUILD.md here.
    const owned = parseOwnedEntries(splitLines(amendments));
    const ownedIssues = checkOwnedEntries(owned, parseMilestones(splitLines(text)));

    for (const issue of ownedIssues) {
      failed = true;
      findings.push({ level: 'error', message: `[${issue.rule}] ${issue.message}` });
    }

    if (ownedIssues.length === 0) {
      const open = owned.filter((entry) => !entry.done).length;
      findings.push({
        level: 'info',
        message: `${String(owned.length)} RETROFIT and TX entries in ${BUILD_AMENDMENTS_FILE}, and every open one of the ${String(open)} is inside a live milestone`,
      });
    }

    return Promise.resolve({
      id: buildManifestGate.id,
      title: buildManifestGate.title,
      status: failed ? 'fail' : 'pass',
      findings,
    });
  },
};
