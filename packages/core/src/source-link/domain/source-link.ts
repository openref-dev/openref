/**
 * Expanding a source link template, per SPEC 6.3.
 *
 * IT IS IN `core` AND T018 BUILT IT WHILE NAMING `nest`, which is a task text defect recorded in
 * BUILD-AMENDMENTS.md rather than a deviation. The expansion has two consumers: `nest` puts a link
 * into the IR and `render` shows it, and the dependency rule is `nest -> render` and never the
 * reverse. An expander written in `nest` is one `render` cannot reach, so `render` grows a second
 * copy, and two copies of a URL builder disagree the first time a forge changes a path. They
 * disagree silently, because each has its own tests and both are green.
 *
 * IT IS PURE AND KNOWS NOTHING ABOUT A FILE SYSTEM, A PROCESS OR GIT. Everything that has to look
 * at the machine, the inspector locator, the source map, the repository relative path and reading
 * `{ref}` out of git, is in `nest`, because `core` may have none of those.
 *
 * THREE FORGES, ONE TEMPLATE, AND THAT IS THE WHOLE REASON THIS IS A TEMPLATE. GitHub, GitLab and
 * Bitbucket differ in the host, the path and the line anchor, and in nothing this function has to
 * know about:
 *
 * - `https://github.com/org/repo/blob/{ref}/{file}#L{line}`
 * - `https://gitlab.com/org/repo/-/blob/{ref}/{file}#L{line}`
 * - `https://bitbucket.org/org/repo/src/{ref}/{file}#lines-{line}`
 *
 * A FAILED EXPANSION SAYS WHY AND PRODUCES NOTHING, per SPEC 0 and CLAUDE.md's rule against
 * guessing. A link with `{file}` still in it, or with `#LNaN` at the end, is worse than no link:
 * it renders as a link, it is clickable, and it lands on a 404 that the reader blames on the
 * repository rather than on the reference.
 */

import type { IRSourceLocation } from '../../ir/domain/runtime.types';

/** What an expansion produced, or why it produced nothing. */
export interface SourceLinkExpansion {
  /** The link. Absent whenever `reason` is present, and present otherwise. */
  readonly url?: string;
  /**
   * Why there is no link, phrased for a reader of `doctor` rather than for a log.
   *
   * Absent when there is a link, so the two fields are never both set and never both absent.
   */
  readonly reason?: string;
  /**
   * True when a link was produced but points at the file rather than the line.
   *
   * IT IS REPORTED RATHER THAN LEFT TO BE NOTICED. Degrading to a file link is the correct
   * behaviour and it is also the signal that a build has no source maps, which is the difference
   * between the headline feature of this milestone working and appearing to work.
   */
  readonly withoutLine?: boolean;
}

/** The placeholders this function fills, and the whole set of them. */
const PLACEHOLDER = /\{(ref|file|line)\}/g;

/** Anything left over after a substitution, which is a template this function cannot honour. */
const ANY_PLACEHOLDER = /\{[^{}]*\}/;

/**
 * Expands a source link template for one location.
 *
 * @param template - The template, holding `{ref}`, `{file}` and `{line}` and nothing else
 * @param location - Where the operation is implemented, as the source collector found it
 * @param ref - The git revision, when the caller resolved one
 * @returns The link, or the reason there is none
 */
export function expandSourceLink(
  template: string,
  location: IRSourceLocation,
  ref?: string,
): SourceLinkExpansion {
  const subject = `${location.controller}.${location.handler}`;

  if (typeof template !== 'string' || template === '') {
    return { reason: `no source link template is configured, so ${subject} cannot be linked` };
  }

  const file = location.file;
  if (file === undefined || file === '') {
    return {
      reason:
        `the source of ${subject} was found but its file was not, so there is nothing to ` +
        'link to. A link to a repository root would point at the wrong thing rather than at less',
    };
  }

  // A LINE THAT IS NOT A POSITIVE INTEGER IS NO LINE, and this is where `#LNaN` is refused rather
  // than in the caller. The collector already declines to guess, and this is the second reader of
  // the same field: a serialized IR that arrived from somewhere else carries whatever it carries.
  const line =
    typeof location.line === 'number' && Number.isInteger(location.line) && location.line > 0
      ? location.line
      : undefined;

  const withoutLine = line === undefined;
  const usable = withoutLine ? withoutLineAnchor(template) : template;

  const expanded = usable.replace(PLACEHOLDER, (whole, name: string) => {
    if (name === 'ref') return ref ?? whole;
    if (name === 'file') return encodePath(file);
    return line === undefined ? whole : String(line);
  });

  const leftover = ANY_PLACEHOLDER.exec(expanded);
  if (leftover !== null) {
    return { reason: reasonFor(leftover[0], subject, ref) };
  }

  if (!isAbsoluteUrl(expanded)) {
    return {
      reason:
        `the source link template expanded to "${expanded}", which is not an absolute URL. ` +
        'SPEC 6.3 links into a repository, so the template carries its scheme and host',
    };
  }

  return withoutLine ? { url: expanded, withoutLine: true } : { url: expanded };
}

/**
 * Removes the fragment when the fragment is the line anchor.
 *
 * THE FRAGMENT IS DROPPED WHOLE RATHER THAN THE PLACEHOLDER BEING BLANKED, and the difference is
 * the whole of T018's fourth test. `#L{line}` with the number removed is `#L`, and
 * `#lines-{line}` becomes `#lines-`: both are links to an anchor no page has, which is a link
 * that silently does nothing. Dropping the fragment gives a link to the file, which is the honest
 * degradation and is what a reader without source maps should get.
 *
 * A `{line}` OUTSIDE THE FRAGMENT IS LEFT ALONE HERE, so the leftover check refuses the template
 * by name. A forge that puts the line in the path rather than in the anchor has no file link to
 * degrade to, and inventing one would be guessing at a URL scheme this function does not know.
 *
 * @param template - The template as configured
 * @returns The template without its line anchor, or unchanged when the anchor is not one
 */
function withoutLineAnchor(template: string): string {
  const hash = template.indexOf('#');
  if (hash === -1) return template;

  return template.slice(hash).includes('{line}') ? template.slice(0, hash) : template;
}

/**
 * Encodes a repository relative path for a URL, keeping its separators.
 *
 * `encodeURIComponent` on the whole path would turn every `/` into `%2F` and give one path
 * segment named after the whole file, which no forge resolves. Per segment it is exactly right:
 * a directory called `my orders` becomes `my%20orders` and the path still has its shape.
 *
 * @param file - Repository relative path, with forward slashes
 * @returns The same path, safe to put in a URL
 */
function encodePath(file: string): string {
  return file.split('/').map(encodeURIComponent).join('/');
}

/**
 * Reports whether a string is an absolute URL.
 *
 * @param value - The expanded template
 * @returns True when it parses on its own, without a base
 */
function isAbsoluteUrl(value: string): boolean {
  return URL.canParse(value);
}

/**
 * Names the placeholder that could not be filled, and what to do about it.
 *
 * @param leftover - The placeholder still in the string, such as `{ref}`
 * @param subject - The class and method being linked, for the message
 * @param ref - Whatever ref the caller had, so the `{ref}` case can say it had none
 * @returns The reason, phrased for whoever wrote the template
 */
function reasonFor(leftover: string, subject: string, ref: string | undefined): string {
  if (leftover === '{ref}' && ref === undefined) {
    return (
      `the source link template needs {ref} and no git revision was resolved, so ${subject} ` +
      'cannot be linked. Set it explicitly with sourceLink: { template, ref } in a build that ' +
      'has no .git directory'
    );
  }

  return (
    `the source link template holds ${leftover}, which is not one of {ref}, {file} or {line}, ` +
    `so ${subject} cannot be linked. A link carrying an unfilled placeholder would be clickable ` +
    'and wrong'
  );
}
