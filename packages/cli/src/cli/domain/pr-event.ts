/**
 * The part of a GitHub event payload `openref pr` reads, and nothing else.
 *
 * IT IS PARSED, NOT CAST. The payload is a file written by GitHub whose shape this package does
 * not control, and every field is read through a narrowing that answers undefined rather than
 * throwing. A missing field is a fact the command reports; it is never a reason to crash and it
 * is never a reason to proceed as if the field said what the happy path wanted.
 *
 * FORK DETECTION IS THE ONE THAT MATTERS AND IT FAILS CLOSED. `head.repo` is null when the fork
 * has been deleted, and an unreadable pair of repository names is treated as a fork, because the
 * consequence of guessing wrong in that direction is a comment that does not appear, and in the
 * other direction it is a request sent with a token that was never write scoped.
 */

/** What one pull request event says, reduced to the fields this command uses. */
export interface PullRequestEvent {
  readonly number: number | undefined;
  readonly baseRef: string | undefined;
  readonly baseSha: string | undefined;
  readonly baseRepository: string | undefined;
  readonly headRepository: string | undefined;
  /** True when the head is not the base repository, and true when that cannot be established. */
  readonly fromFork: boolean;
}

/** The event name GitHub runs with a write scoped token over a head nobody has reviewed. */
export const REFUSED_EVENT_NAME = 'pull_request_target';

function objectAt(value: unknown, key: string): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const child = (value as Record<string, unknown>)[key];
  return typeof child === 'object' && child !== null
    ? (child as Record<string, unknown>)
    : undefined;
}

function stringAt(value: Record<string, unknown> | undefined, key: string): string | undefined {
  const child = value?.[key];
  return typeof child === 'string' && child !== '' ? child : undefined;
}

function numberAt(value: Record<string, unknown> | undefined, key: string): number | undefined {
  const child = value?.[key];
  return typeof child === 'number' && Number.isInteger(child) && child > 0 ? child : undefined;
}

/**
 * Reads a pull request event payload.
 *
 * @param json - The whole file at `GITHUB_EVENT_PATH`
 * @returns What it says, or undefined when it is not a pull request event at all
 */
export function readPullRequestEvent(json: string): PullRequestEvent | undefined {
  let payload: unknown;
  try {
    payload = JSON.parse(json);
  } catch {
    return undefined;
  }

  const pullRequest = objectAt(payload, 'pull_request');
  if (pullRequest === undefined) return undefined;

  const base = objectAt(pullRequest, 'base');
  const head = objectAt(pullRequest, 'head');
  const baseRepository = stringAt(objectAt(base, 'repo'), 'full_name');
  const headRepository = stringAt(objectAt(head, 'repo'), 'full_name');

  return {
    // `number` AND NOT `id`. They are both integers on this object and they are different
    // numbers: `id` is global to GitHub and addresses nothing under `/issues/`. A fallback
    // between them would produce a request that succeeds against somebody else's pull request.
    number: numberAt(pullRequest, 'number'),
    baseRef: stringAt(base, 'ref'),
    baseSha: stringAt(base, 'sha'),
    baseRepository,
    headRepository,
    fromFork:
      baseRepository === undefined ||
      headRepository === undefined ||
      baseRepository !== headRepository,
  };
}
