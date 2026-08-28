/**
 * `owner/name`, parsed into its two halves before anything builds a URL out of it.
 *
 * THIS IS THE SAME CLASS SPEC 19 CLOSED FOR THE STATIC PROXY IN T040, LEFT OPEN HERE. The value
 * arrives from `--repository` or `OPENREF_PR_REPOSITORY`, and it was concatenated into the API
 * address as written, so `../../escaped` walked the token bearing request out of `/repos/` and
 * `%2e%2e/%2e%2e/x` did the same one decoding later. The pull request number was validated; this
 * half was not.
 *
 * IT IS A PAIR AND NOT A STRING, WHICH IS THE POINT. The URL builder takes `RepositorySlug`, so a
 * raw string cannot reach it at all: there is no assignment from `string` to this shape, and the
 * only way to obtain one is `parseRepositorySlug`. A guard that hands back the same type it was
 * given can be skipped by the next call site somebody writes; this one cannot be.
 *
 * IT REFUSES RATHER THAN REPAIRS. Nothing here decodes, normalizes or strips: a percent sign, a
 * colon, a backslash, whitespace or anything outside the two allowlists makes the whole value a
 * usage error, because deciding what an encoded value meant is deciding for GitHub, whom nobody
 * asked. That sentence was true of this function and false of the path into it until T041's final
 * review: the caller trimmed an environment value before handing it over, so a leading tab on
 * `OPENREF_PR_REPOSITORY` was repaired and accepted while the same value as `--repository` was
 * refused. Nothing trims this value now, on either path.
 *
 * THE REFUSAL NAMES THE SOURCE THE VALUE CAME FROM. The same string arrives three ways, and a
 * message that always said `--repository` sent a reader to edit a flag they never wrote.
 */

/** One repository, as the two segments GitHub addresses it by. */
export interface RepositorySlug {
  readonly owner: string;
  readonly name: string;
}

/**
 * The longest owner GitHub issues.
 *
 * Both lengths here are GitHub's own limits rather than this project's taste, and they are
 * checked so a value far outside them is refused before it is ever sent.
 */
export const MAX_OWNER_LENGTH = 39;

/** The longest repository name GitHub issues. */
export const MAX_NAME_LENGTH = 100;

/** Alphanumerics and single hyphens, never at either end: GitHub's rule for an account name. */
const OWNER = /^[A-Za-z0-9](?:-?[A-Za-z0-9])*$/;

/** Alphanumerics, hyphen, underscore and dot: GitHub's rule for a repository name. */
const NAME = /^[A-Za-z0-9._-]+$/;

/**
 * Spellings that make a value ambiguous to a URL, refused wherever in it they appear.
 *
 * This class exists so the refusal can say what it saw. It is not the security boundary: the two
 * allowlists above are, because they admit nothing that is not in them, control characters and
 * every non ASCII byte included.
 */
const FORBIDDEN = /[%:\\?#@\s]/;

/**
 * Parses `owner/name`, or says why it is not one.
 *
 * @param value - The raw value, exactly as a flag or an environment variable supplied it
 * @param source - What supplied it, so the refusal points at the thing to fix
 * @returns The pair, or the one message that stopped it
 */
export function parseRepositorySlug(
  value: string,
  source = '--repository',
): RepositorySlug | { readonly usageError: string } {
  const refusal = (why: string): { readonly usageError: string } => ({
    usageError: `${source} ${JSON.stringify(value)} ${why}. It has to be exactly owner/name`,
  });

  if (value === '') return refusal('is empty');
  if (FORBIDDEN.test(value)) {
    return refusal(
      'holds a character that has no place in owner/name: percent, colon, backslash, question ' +
        'mark, hash, at sign or whitespace. Nothing here decodes it, since deciding what an ' +
        'encoded value meant is deciding for GitHub',
    );
  }

  const segments = value.split('/');
  if (segments.length !== 2) {
    return refusal(`has ${String(segments.length)} slash separated segment(s) rather than two`);
  }

  const [owner, name] = segments;
  if (owner === undefined || name === undefined) return refusal('is not two segments');

  if (owner.length > MAX_OWNER_LENGTH) {
    return refusal(
      `names an owner longer than the ${String(MAX_OWNER_LENGTH)} characters GitHub allows`,
    );
  }
  if (!OWNER.test(owner)) {
    return refusal(
      'names an owner that is not alphanumerics and single hyphens away from either end',
    );
  }

  if (name.length > MAX_NAME_LENGTH) {
    return refusal(
      `names a repository longer than the ${String(MAX_NAME_LENGTH)} characters GitHub allows`,
    );
  }
  if (name === '.' || name === '..') {
    return refusal('names a dot segment, which addresses a directory rather than a repository');
  }
  if (!NAME.test(name)) {
    return refusal('names a repository outside alphanumerics, dot, hyphen and underscore');
  }

  return { owner, name };
}

/**
 * The `owner/name` path segment of a parsed slug.
 *
 * @param slug - The parsed pair
 * @returns The two segments joined by the one separator they are allowed
 */
export function repositoryPath(slug: RepositorySlug): string {
  return `${slug.owner}/${slug.name}`;
}
