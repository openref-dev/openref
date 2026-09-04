import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  BUILD_AMENDMENTS_FILE,
  BUILD_FILE,
  BUILD_LINE_COUNT,
  BUILD_TASK_COUNT,
  DEFERRAL_SOURCE_EXTENSIONS,
} from '../config.js';
import {
  parseMilestones,
  parseOwnedEntries,
  POST_RELEASE_MILESTONE,
  splitLines,
} from '../lib/build-manifest.js';
import { PROJECTION_FILE, readProjection } from '../lib/projection.js';
import {
  checkDeferrals,
  checkMaterial,
  findMarkers,
  type DeferralIssue,
  type DeferralMarker,
  type MilestoneState,
  type PostReleaseEntry,
} from '../lib/deferrals.js';
import { PROJECT_ROOTS } from '../lib/spec-placement.js';
import { collectFiles } from '../lib/walk.js';
import type { Gate, GateContext, GateFinding, GateResult } from '../types.js';

/**
 * Every `src` directory of every workspace project, read from the disk.
 *
 * DERIVED RATHER THAN LISTED, per the rule `readPackageDirs` was written for: a hand kept list of
 * directories is a check whose completeness is whoever last touched it, and the one thing this
 * gate exists to prevent is a deferral nothing reads. `test` is deliberately outside the sweep,
 * and the reason is not convenience: a marker inside a test is that test's material, and a check
 * that read its own fixtures would go red on the cases proving it can go red.
 *
 * @param repoRoot - Absolute repository root
 * @returns Repository relative directories, sorted
 */
export function sourceRoots(repoRoot: string): string[] {
  const roots: string[] = [];

  for (const workspace of PROJECT_ROOTS) {
    let projects: string[];
    try {
      projects = readdirSync(join(repoRoot, workspace));
    } catch {
      continue;
    }

    for (const project of projects.sort()) {
      const source = join(repoRoot, workspace, project, 'src');
      if (statSync(source, { throwIfNoEntry: false })?.isDirectory() === true) {
        roots.push(`${workspace}/${project}/src`);
      }
    }
  }

  return roots;
}

/**
 * Reads every parenthesised milestone out of a set of files.
 *
 * USED FOR THE SOURCE HALF ONLY SINCE THE PROJECTION ARRIVED. The seven documents are under
 * `ai-docs/` and their markers travel in the committed artefact; a marker is a parenthesis in the
 * closed vocabulary the pattern defines, so it ships as itself and carries nothing anybody wrote.
 *
 * @param repoRoot - Absolute repository root
 * @param files - Repository relative paths; one that cannot be read contributes nothing
 * @returns The markers, in file order
 */
function markersIn(repoRoot: string, files: readonly string[]): DeferralMarker[] {
  const markers: DeferralMarker[] = [];

  for (const file of files) {
    const path = join(repoRoot, file);
    if (!existsSync(path)) continue;
    markers.push(...findMarkers(file, readFileSync(path, 'utf8')));
  }

  return markers;
}

/** One line of the census, so a green run still prints what it read. */
function census(markers: readonly DeferralMarker[]): string {
  const byKind = (kind: string): number => markers.filter((marker) => marker.kind === kind).length;
  const files = new Set(markers.map((marker) => marker.file)).size;

  return (
    `${String(markers.length)} parenthesised milestone(s) over ${String(files)} file(s): ` +
    `${String(byKind('deferral'))} deferral, ${String(byKind('provenance'))} provenance, ` +
    `${String(byKind('quotation'))} quoted, ${String(byKind('ambiguous'))} saying neither`
  );
}

/**
 * Holds every deferral that names a milestone to the milestone it names.
 *
 * IT IS THE `checkOwnedEntries` MECHANISM POINTED AT THE OTHER REGISTER, and it is a gate of its
 * own rather than a check inside `build-manifest` because the two read different material: that
 * one reads the plan and the entries filed against it, this one reads the specification, the
 * conventions and every `src` directory in the workspace. A failure here is about a sentence
 * somebody wrote, and it has to say so in its own title.
 *
 * THE DOCUMENT HALF ARRIVES THROUGH THE COMMITTED PROJECTION AND NO LONGER SKIPS. A marker is a
 * parenthesis in the four form vocabulary `MARKER_PATTERN` fixes, so it ships
 * as itself with its file and its line; the milestones and the entries that expire it ship as ids,
 * boxes and line numbers. Until the artefact this half ran on the maintainer's machine alone,
 * which is where the defect it exists for was found and the one place it could never recur.
 *
 * WHY IT RUNS SECOND. `build-manifest` establishes that the plan still means what its ranges say;
 * this asks whether the obligations written against that plan have outlived it. Both are questions
 * about the bookkeeping rather than about the code, and neither needs anything built.
 */
export function runDeferralsGate(context: GateContext): GateResult {
  const findings: GateFinding[] = [];
  const roots = sourceRoots(context.repoRoot);
  const sourceFiles = roots.flatMap((root) =>
    collectFiles(join(context.repoRoot, root), DEFERRAL_SOURCE_EXTENSIONS, context.repoRoot),
  );

  findings.push({
    level: 'info',
    message: `${String(sourceFiles.length)} source file(s) under ${String(roots.length)} project(s) swept`,
  });

  const sourceMarkers = markersIn(context.repoRoot, sourceFiles);

  const read = readProjection(context.repoRoot);

  if (!read.ok) {
    return {
      id: deferralsGate.id,
      title: deferralsGate.title,
      status: 'fail',
      findings: [
        ...findings,
        { level: 'info', message: census(sourceMarkers) },
        { level: 'error', message: `[projection-unreadable] ${read.reason}` },
      ],
    };
  }

  const build = read.projection.data.build;
  const amendments = read.projection.data.amendments;

  if (build === null || amendments === null) {
    return {
      id: deferralsGate.id,
      title: deferralsGate.title,
      status: 'fail',
      findings: [
        ...findings,
        { level: 'info', message: census(sourceMarkers) },
        {
          level: 'error',
          message: `${BUILD_FILE} or ${BUILD_AMENDMENTS_FILE} was not readable when ${PROJECTION_FILE} was generated, so no deferral can be held to a milestone`,
        },
      ],
    };
  }

  const markers = [...read.projection.data.markers, ...sourceMarkers];
  findings.push({ level: 'info', message: census(markers) });

  const milestones: MilestoneState[] = parseMilestones(splitLines(build)).map((milestone) => ({
    id: milestone.id,
    label: milestone.label,
    closed: milestone.tasks.every((task) => task.done),
  }));

  const entries: PostReleaseEntry[] = parseOwnedEntries(splitLines(amendments))
    .filter((entry) => entry.milestone === POST_RELEASE_MILESTONE)
    .map((entry) => ({ id: entry.id, done: entry.done, line: entry.line }));

  const issues: DeferralIssue[] = checkDeferrals(markers, milestones, entries);
  const empty = checkMaterial(markers);
  if (empty !== undefined) issues.push(empty);

  for (const issue of issues) {
    findings.push({ level: 'error', message: `[${issue.rule}] ${issue.message}` });
  }

  const open = entries.filter((entry) => !entry.done);
  findings.push({
    level: open.length === 0 ? 'info' : 'warning',
    message:
      `${String(entries.length)} ${POST_RELEASE_MILESTONE} entry/entries in ${BUILD_AMENDMENTS_FILE}, ${String(open.length)} open: ` +
      `${open.map((entry) => entry.id).join(', ') || 'none'}. ` +
      `Nothing in the plan expires these, because the plan ends at its last milestone; the regeneration that would give them one ` +
      `moves BUILD.md off its ${String(BUILD_LINE_COUNT)} lines and ${String(BUILD_TASK_COUNT)} tasks, which build-manifest fails on until both follow`,
  });

  findings.push({
    level: 'info',
    message: `${String(milestones.length)} milestone(s) read from ${BUILD_FILE}, ${String(milestones.filter((milestone) => milestone.closed).length)} of them closed`,
  });

  return {
    id: deferralsGate.id,
    title: deferralsGate.title,
    status: issues.length === 0 ? 'pass' : 'fail',
    findings,
  };
}

export const deferralsGate: Gate = {
  id: 'deferrals',
  title: 'Every deferral names a milestone a check can read, and no closed one still carries',

  run(context): Promise<GateResult> {
    return Promise.resolve(runDeferralsGate(context));
  },
};
