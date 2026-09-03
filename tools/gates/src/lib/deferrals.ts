/**
 * A deferral that names a milestone, in a form a check can read.
 *
 * THE MECHANISM EXISTED AND THE REGISTER IT GUARDED WAS THE WRONG ONE. `checkOwnedEntries` holds
 * every open entry of `ai-docs/BUILD-AMENDMENTS.md` to the milestone its `**Milestone:**` line
 * names, and fails the build the day that milestone runs out of unticked tasks. It was built on
 * 2026-08-13 against exactly this failure, after `TX-SERVED` said owner M1 with M1 closed. What
 * nothing guarded was the specification itself: SPEC 17.1 deferred comparing event channels with
 * a parenthesis reading "(M5)", M5 closed at `T054`, ten tasks closed after it, and no mechanism
 * anywhere could see the marker, because to every mechanism it was prose. The same marker had a
 * twin in `packages/core/src/diff/domain/diff-report.ts`, and the session that fixed the prose did
 * not touch the code, for the same reason: nothing read either.
 *
 * WHAT THE AMBIGUITY WAS, AND IT IS THE DEFECT RATHER THAN A SYMPTOM OF IT. A milestone in
 * parentheses reads as provenance to somebody opening the document today, "channels, which
 * arrived in M5", and it was written as a deferral, "channels, which M5 owes". A reader cannot
 * tell the two apart, and neither can a checker. So a parenthesised milestone now says which of
 * the two it is:
 *
 * - "(DEFER M5)" is work milestone M5 owes, and it goes red the day M5 has no unticked task left
 * - "(DEFER POST-1.0, TX-NAME)" is work that lands after the plan's last milestone, and it names
 *   the open entry of `ai-docs/BUILD-AMENDMENTS.md` that owns it
 * - "(с M5)" and "(from M5)" are provenance: the thing exists, and it arrived in M5. Neither can
 *   expire, because nothing is owed
 * - a bare milestone in parentheses is refused, since that is the form that carried
 *
 * A QUOTATION IS NOT A MARKER, and the exemption is required rather than convenient: the record of
 * this defect quotes the marker it is about, four times in `BUILD-AMENDMENTS.md` and once in SPEC
 * 0, and a rule that could not be quoted would delete its own evidence. An occurrence that follows
 * an unmatched straight quote or an opening guillemet on its line is somebody's words being
 * reported rather than a claim this repository is making.
 *
 * WHAT THIS METHOD DOES NOT SEE, per SPEC 0's tenth class, named here where a reader meets it: a
 * deferral written in running prose with no parentheses. The words "channels left to M5", one
 * line further down the same file the marker was found in, are invisible to every rule below. The
 * half that catches those is not this file: it is `checkOwnedEntries` over the amendments
 * register, where a deferral has to be an entry with a `**Milestone:**` line rather than a
 * sentence. Two checks over two registers, and the prose between them is named as uncovered
 * instead of assumed clean.
 */

import { POST_RELEASE_MILESTONE } from './build-manifest.js';

/** What a parenthesised milestone in a document turned out to be. */
export type MarkerKind = 'deferral' | 'provenance' | 'ambiguous' | 'quotation';

/** One parenthesised milestone, as written, with where it was found. */
export interface DeferralMarker {
  /** Repository relative path of the file it was read from. */
  readonly file: string;
  /** Line it sits on, 1 based, so a message can send a reader to it. */
  readonly line: number;
  /** The marker exactly as the file writes it. */
  readonly text: string;
  readonly kind: MarkerKind;
  /** Milestone id the marker names, empty for an ambiguous one. */
  readonly owner: string;
  /** Amendment entry a post release marker hands the work to, empty when it names none. */
  readonly entry: string;
}

/** One problem found among the markers. */
export interface DeferralIssue {
  readonly rule: string;
  readonly message: string;
}

/**
 * Every parenthesised milestone, in the three forms the rule allows and the one it refuses.
 *
 * Written as one expression rather than four so that a form nobody thought of lands in
 * `ambiguous` instead of falling out of the sweep. The post release owner is only ever a
 * deferral, since nothing can have arrived from a milestone the plan does not carry yet.
 */
const MARKER_PATTERN =
  /\((?:(DEFER)\s+(M\d+|RELEASE|POST-1\.0)(?:,\s*`?([A-Za-z0-9-]+)`?)?|(с|from)\s+(M\d+)|(M\d+))\)/g;

/**
 * Whether an offset on a line falls inside a quotation.
 *
 * The straight quote opens and closes with the same character, so the parity of the count before
 * the offset decides. The guillemets are a pair and a quoted sentence in these documents wraps
 * across lines, so an opening one that has not been closed before the offset is enough; requiring
 * the closer on the same line was tried first and missed the quotation at
 * `ai-docs/BUILD-AMENDMENTS.md` L9150, whose closing guillemet is on the line below.
 *
 * @param line - The whole line
 * @param offset - Index of the marker's first character within it
 * @returns True when the marker is being quoted rather than written
 */
export function insideQuotes(line: string, offset: number): boolean {
  const before = line.slice(0, offset);

  if ((before.split('"').length - 1) % 2 === 1) return true;

  return before.lastIndexOf('«') > before.lastIndexOf('»');
}

/**
 * Reads every parenthesised milestone out of one file.
 *
 * THE SWEEP IS OVER THE WHOLE TEXT AND NOT LINE BY LINE, AND THE FIRST VERSION WAS LINE BY LINE.
 * Measured on the day it was written: the marker added to SPEC 17.1 wrapped after the comma, the
 * check found nothing, and the run was green with the marker sitting there unread. That is the
 * defect this file exists about, one level down, so the separators inside the parentheses admit a
 * line break and the line number is derived from the offset instead.
 *
 * @param file - Repository relative path, carried into the findings
 * @param text - Whole contents of the file
 * @returns The markers in file order
 */
export function findMarkers(file: string, text: string): DeferralMarker[] {
  const markers: DeferralMarker[] = [];

  for (const match of text.matchAll(MARKER_PATTERN)) {
    const offset = match.index;
    const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
    const lineEnd = text.indexOf('\n', offset);
    const line = text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd);

    const quoted = insideQuotes(line, offset - lineStart);
    const owner = match[2] ?? match[5] ?? match[6] ?? '';
    const kind = markerKind(quoted, match[1] !== undefined, match[4] !== undefined);

    markers.push({
      file,
      line: text.slice(0, offset).split('\n').length,
      text: match[0].replace(/\s+/g, ' '),
      kind,
      owner: kind === 'ambiguous' ? '' : owner,
      entry: match[3] ?? '',
    });
  }

  return markers;
}

function markerKind(quoted: boolean, defers: boolean, states: boolean): MarkerKind {
  if (quoted) return 'quotation';
  if (defers) return 'deferral';
  return states ? 'provenance' : 'ambiguous';
}

/** A milestone of the plan, reduced to the one thing a deferral asks of it. */
export interface MilestoneState {
  readonly id: string;
  readonly label: string;
  /** True when every task written under it is ticked. */
  readonly closed: boolean;
}

/** An entry of the amendments that can own work scheduled past the plan's last milestone. */
export interface PostReleaseEntry {
  readonly id: string;
  readonly done: boolean;
  readonly line: number;
}

/**
 * Holds every marker to the milestone or the entry it names.
 *
 * The checks run in both directions, the way every list in this repository is checked: a marker
 * whose milestone has closed is a deferral nobody is held to, and an open post release entry that
 * no marker points at is work no reader of the specification can discover.
 *
 * @param markers - Every marker read from the swept files
 * @param milestones - The milestones of `ai-docs/BUILD.md`, with whether each has closed
 * @param entries - The open and closed post release entries of the amendments
 * @returns Every problem found, empty when no deferral has outlived its owner
 */
export function checkDeferrals(
  markers: readonly DeferralMarker[],
  milestones: readonly MilestoneState[],
  entries: readonly PostReleaseEntry[],
): DeferralIssue[] {
  const issues: DeferralIssue[] = [];
  const byId = new Map(milestones.map((milestone) => [milestone.id, milestone]));
  const entryById = new Map(entries.map((entry) => [entry.id, entry]));
  const named = new Set<string>();

  for (const marker of markers) {
    const at = `${marker.file}:${String(marker.line)}`;

    if (marker.kind === 'quotation') continue;

    if (marker.kind === 'ambiguous') {
      issues.push({
        rule: 'deferral-ambiguous',
        message:
          `${at} writes ${marker.text}, which says neither that the work is owed nor that it arrived. ` +
          'Write DEFER inside the parentheses for work a milestone owes, or the word for arrival for something that came with one. ' +
          'This is the form SPEC 17.1 carried for ten tasks after the milestone it named had closed',
      });
      continue;
    }

    if (marker.kind === 'provenance') {
      if (byId.has(marker.owner)) continue;
      issues.push({
        rule: 'deferral-unknown-milestone',
        message: `${at} writes ${marker.text}, and ${marker.owner} is not a milestone BUILD.md carries`,
      });
      continue;
    }

    if (marker.owner === POST_RELEASE_MILESTONE) {
      issues.push(...checkPostReleaseMarker(marker, at, entryById, named));
      continue;
    }

    const milestone = byId.get(marker.owner);

    if (milestone === undefined) {
      issues.push({
        rule: 'deferral-unknown-milestone',
        message: `${at} defers to ${marker.owner}, which is not a milestone BUILD.md carries`,
      });
      continue;
    }

    if (milestone.closed) {
      issues.push({
        rule: 'deferral-expired',
        message:
          `${at} defers to ${milestone.label}, and every task of that milestone is ticked: ${marker.text}. ` +
          'A deferral that names a closed milestone is owed either the work or a new sentence',
      });
    }
  }

  for (const entry of entries) {
    if (entry.done || named.has(entry.id)) continue;

    issues.push({
      rule: 'post-release-entry-unreferenced',
      message:
        `${entry.id} is an open ${POST_RELEASE_MILESTONE} entry at L${String(entry.line)} that no marker points at. ` +
        'The entry is where the work is written and the marker is where a reader of the specification meets it, ' +
        'so an entry nothing points at is work nobody arrives at',
    });
  }

  return issues;
}

function checkPostReleaseMarker(
  marker: DeferralMarker,
  at: string,
  entryById: ReadonlyMap<string, PostReleaseEntry>,
  named: Set<string>,
): DeferralIssue[] {
  if (marker.entry === '') {
    return [
      {
        rule: 'deferral-unowned',
        message:
          `${at} defers past the plan's last milestone and names no entry. ` +
          'Work with no milestone left to expire against names the amendment entry that owns it, inside the same parentheses',
      },
    ];
  }

  named.add(marker.entry);
  const entry = entryById.get(marker.entry);

  if (entry === undefined) {
    return [
      {
        rule: 'deferral-unowned',
        message:
          `${at} hands its work to ${marker.entry}, and the amendments carry no ${POST_RELEASE_MILESTONE} entry of that id. ` +
          'A deferral addressed to nothing is read by nobody',
      },
    ];
  }

  if (entry.done) {
    return [
      {
        rule: 'deferral-owner-closed',
        message:
          `${at} still defers to ${marker.entry}, and that entry is ticked at L${String(entry.line)}. ` +
          'Either the work landed, in which case the marker goes, or the entry closed over it',
      },
    ];
  }

  return [];
}

/**
 * Whether the sweep found anything at all to check.
 *
 * A CHECK WITH NO MATERIAL IS INDISTINGUISHABLE FROM A CHECK THAT WORKS, which is SPEC 0's sixth
 * class and the reason this is a rule of its own rather than a comment. Every rule above is green
 * over an empty list of markers, so the empty list has to be a failure in itself.
 *
 * @param markers - Every marker read from the swept files
 * @returns The issue, or undefined when there was material
 */
export function checkMaterial(markers: readonly DeferralMarker[]): DeferralIssue | undefined {
  if (markers.length > 0) return undefined;

  return {
    rule: 'deferral-no-material',
    message:
      'the sweep found no parenthesised milestone anywhere, in any of the four forms. ' +
      'Every rule here is green over an empty list, so an empty list is reported rather than passed',
  };
}
