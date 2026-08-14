/**
 * Capabilities that are built, tested and correct, and that no shipped path reaches.
 *
 * THIS IS THE EIGHTH DEFECT CLASS OF SPEC 0 AND ITS ENFORCER. The seventh was an artefact that
 * cannot execute where it ships; this one executes perfectly and is never called, because no
 * branch of the page a reader loads selects it. Both are invisible to every gate that asks what
 * the artefact contains, because the answer to that question is yes.
 *
 * IT IS THE SHAPE OF `BUDGET_EXCEPTIONS`, DELIBERATELY, AND NOT THE SAME LIST. The rules are the
 * same rules: an entry names what is unreachable, who owns the wiring, and the milestone it must
 * be reachable by, and the milestone cannot close while the entry is here. What differs is the
 * fact being recorded and the way an entry expires. A budget exception expires when a number
 * measured this run comes back inside its limit; this expires when a marker the entry names
 * appears in the built bundle, which is the only evidence available from outside that a shipped
 * path now reaches the thing.
 *
 * THE MARKER IS EVIDENCE AND NOT PROOF, AND THE ENTRY SAYS SO. What it can show is that the
 * shipped bundle now carries the fact the capability is selected by, which is exactly the thing
 * that was absent while the capability was dead. What proves the two halves meet is a browser
 * case, and the owning task carries that as its own done-when clause. A gate that waited for
 * proof it cannot obtain would be a gate that never fails, which is the failure mode this whole
 * file exists to refuse.
 *
 * WHY IT FAILS IN BOTH DIRECTIONS. An entry whose marker never appears blocks its milestone; an
 * entry whose marker has appeared is a record of a debt that is paid and fails as stale. A list
 * that can only fail one way is a comment with a type annotation.
 */

import type { BuildMilestone } from './build-manifest.js';

/** One capability that exists and that nothing a reader loads can select. */
export interface CapabilityDebt {
  /** Short id, used in messages and unique across the list. */
  readonly id: string;
  /** What is built and unreachable, in one sentence. */
  readonly capability: string;
  /** Tasks that own the wiring. Every one must be a task the plan carries. */
  readonly owners: readonly string[];
  /** Milestone by which it must be reachable. The milestone cannot close while it is here. */
  readonly reachableBy: string;
  /** When the entry was written. */
  readonly recordedAt: string;
  /** Why it is unreachable, measured rather than supposed, and what it would take. */
  readonly diagnosis: string;
  /** Directories of the built bundle the marker is looked for in. */
  readonly roots: readonly string[];
  /**
   * The literal that would appear in the built bundle once a shipped path selects it.
   *
   * A FACT THE PAGE READS RATHER THAN A NAME THE BUNDLE DEFINES. `ProxyHttpTransport` is in the
   * bundle today and proves nothing, because a class ships whether or not anything constructs
   * it. The name of the page model field the browser has to read to make the choice is absent
   * until the choice exists, which is what makes it usable as an expiry.
   */
  readonly marker: string;
}

/** One problem with the list. */
export interface CapabilityDebtIssue {
  readonly rule: string;
  readonly id: string;
  readonly message: string;
}

/** What the list is checked against. */
export interface CapabilityDebtContext {
  /** Every task id the plan carries, from BUILD.md and from the amendments. */
  readonly taskIds: readonly string[];
  /** The milestones of BUILD.md with their tasks, for the expiry check. */
  readonly milestones: readonly BuildMilestone[];
  /** Whether each entry's marker was found in the built bundle, keyed by entry id. */
  readonly markerFound: ReadonlyMap<string, boolean>;
}

/**
 * Checks the list of unreachable capabilities.
 *
 * THE PLAN HALF AND THE ARTEFACT HALF ARE BOTH REQUIRED, and a caller that can supply only one
 * says so by leaving the other out of the context rather than by passing an empty one: an entry
 * with no marker verdict is reported as unchecked, never as expired.
 *
 * @param debts - The entries
 * @param context - The plan and what the built bundle carries
 * @returns Every problem found, empty when the list is in order
 */
export function checkCapabilityDebts(
  debts: readonly CapabilityDebt[],
  context: CapabilityDebtContext,
): CapabilityDebtIssue[] {
  const issues: CapabilityDebtIssue[] = [];
  const taskIds = new Set(context.taskIds);
  const seen = new Set<string>();

  for (const entry of debts) {
    const add = (rule: string, message: string): void => {
      issues.push({ rule, id: entry.id, message });
    };

    if (seen.has(entry.id)) {
      add('duplicate', `${entry.id} has more than one entry, so which terms apply is a guess`);
    }
    seen.add(entry.id);

    for (const [field, value] of [
      ['capability', entry.capability],
      ['recordedAt', entry.recordedAt],
      ['diagnosis', entry.diagnosis],
      ['marker', entry.marker],
    ] as const) {
      if (value.trim().length > 0) continue;
      add(
        'incomplete',
        `${entry.id} has no ${field}. An entry that says nothing is a feature quietly dropped`,
      );
    }

    if (entry.roots.length === 0) {
      add(
        'no-roots',
        `${entry.id} names no built directory to look for its marker in, so it can never expire`,
      );
    }

    if (entry.owners.length === 0) {
      add(
        'no-owner',
        `${entry.id} names no task that owns the wiring, so nothing will come back to it`,
      );
    }

    for (const owner of entry.owners) {
      if (taskIds.has(owner)) continue;
      add(
        'unknown-owner',
        `${entry.id} is owned by ${owner}, which is not a task in BUILD.md or in the amendments`,
      );
    }

    const milestone = context.milestones.find((candidate) => candidate.id === entry.reachableBy);

    if (milestone === undefined) {
      add(
        'unknown-milestone',
        `${entry.id} is reachable by ${entry.reachableBy}, which is not a milestone in BUILD.md, so it has no expiry`,
      );
    } else if (milestone.tasks.every((task) => task.done)) {
      add(
        'milestone-closed',
        `${entry.id} had to be reachable by ${milestone.label}, and every task of that milestone is ticked while it is still here. ` +
          `The milestone is not done: ${entry.capability}, owned by ${entry.owners.join(', ')}`,
      );
    }

    const found = context.markerFound.get(entry.id);

    if (found === undefined) {
      add(
        'unchecked',
        `${entry.id} was not looked for in a built bundle, so nothing here knows whether it is still unreachable`,
      );
    } else if (found) {
      add(
        'stale',
        `${entry.id} names "${entry.marker}" as what would appear once a shipped path selects it, and it is in the bundle now. ` +
          `A stale entry is not coverage: remove it, and check the owning task's browser case is there`,
      );
    }
  }

  return issues;
}

/**
 * One line describing an entry, printed on every run so the debt is never out of sight.
 *
 * @param entry - The debt
 * @returns A single line naming what is unreachable, the owners and the expiry
 */
export function describeCapabilityDebt(entry: CapabilityDebt): string {
  return (
    `${entry.id}: ${entry.capability}, owned by ${entry.owners.join(', ')}, ` +
    `must be reachable by ${entry.reachableBy}, recorded ${entry.recordedAt}. ${entry.diagnosis}`
  );
}
