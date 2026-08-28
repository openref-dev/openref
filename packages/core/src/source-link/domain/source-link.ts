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
 * AND SINCE `T018-R1`, THE EDITOR FORMS, WHICH ARE THE SAME TEMPLATE OVER TWO MORE FACTS. They
 * need no git at all, which is the point of them: a checkout that was never pushed, a directory
 * that is not a repository, and a handler inside a submodule all have a file and a line and no
 * usable forge URL.
 *
 * - `vscode://file/{absolutePath}:{line}:{column}`
 * - `jetbrains://idea/navigate/reference?path=/{absolutePath}:{line}:{column}`
 *
 * A FAILED EXPANSION SAYS WHY AND PRODUCES NOTHING, per SPEC 0 and CLAUDE.md's rule against
 * guessing. A link with `{file}` still in it, or with `#LNaN` at the end, is worse than no link:
 * it renders as a link, it is clickable, and it lands on a 404 that the reader blames on the
 * repository rather than on the reference.
 *
 * THE SCHEME IS CHECKED AGAINST A LIST AND THAT IS A SECURITY RULE, NOT TIDINESS. What comes out
 * of here goes into an `href`, and an editor URL is one the browser hands to the operating
 * system. The template is a field of the IR, and a document arrives from a file, from a CLI, and
 * from M4 onwards from a federated remote, so a template that reached this function could
 * otherwise turn into `javascript:` on a reader's page or into whatever scheme handler the
 * reader's machine happens to register.
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
const PLACEHOLDER = /\{(ref|file|line|absolutePath|column)\}/g;

/** Anything left over after a substitution, which is a template this function cannot honour. */
const ANY_PLACEHOLDER = /\{[^{}]*\}/;

/**
 * The schemes a source link may carry, per SPEC 6.3.
 *
 * AN ALLOWLIST AND NOT A DENYLIST, because the question is not "which schemes execute script" but
 * "which schemes may this product hand to a reader's operating system". Two forges and the editors
 * SPEC 6.3 names are the whole set, and adding one is an edit to that paragraph before it is an
 * edit to this array.
 */
const LINKABLE_SCHEMES: readonly string[] = [
  'http:',
  'https:',
  'vscode:',
  'vscode-insiders:',
  'vscodium:',
  'cursor:',
  'windsurf:',
  'zed:',
  'jetbrains:',
  'idea:',
];

/**
 * Expands a source link template for one location.
 *
 * @param template - The template, holding the five placeholders of SPEC 6.3 and nothing else
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
  const absolutePath = location.absolutePath;
  const wantsFile = template.includes('{file}');
  const wantsAbsolutePath = template.includes('{absolutePath}');

  // A TEMPLATE NAMING NEITHER PATH LINKS EVERY OPERATION TO ONE PAGE, which reads as a working
  // source link and is not one. It is refused here rather than expanded, for the reason the
  // leftover check below exists: a link that is clickable and wrong costs the reader more than
  // no link costs them.
  if (!wantsFile && !wantsAbsolutePath) {
    return {
      reason:
        'the source link template names neither {file} nor {absolutePath}, so every operation ' +
        `would link to the same page. ${subject} is not linked rather than linked wrongly`,
    };
  }

  if (wantsFile && (file === undefined || file === '')) {
    return {
      reason:
        `the source of ${subject} was found but its file was not, so there is nothing to ` +
        'link to. A link to a repository root would point at the wrong thing rather than at less',
    };
  }

  if (wantsAbsolutePath && (absolutePath === undefined || absolutePath === '')) {
    return {
      reason:
        `the source link template needs {absolutePath} and ${subject} carries none. The absolute ` +
        'path is a fact about the machine that built the document, so it is left out unless the ' +
        'host asks for it: register sourceCollector({ absolutePath: true }), and read SPEC 6.3 ' +
        'for what that publishes to everyone who opens the page',
    };
  }

  // A LINE THAT IS NOT A POSITIVE INTEGER IS NO LINE, and this is where `#LNaN` is refused rather
  // than in the caller. The collector already declines to guess, and this is the second reader of
  // the same field: a serialized IR that arrived from somewhere else carries whatever it carries.
  const line = positiveInteger(location.line);
  const column = positiveInteger(location.column);

  const withoutLine = line === undefined;
  const columnDropped = withoutTail(template, '{column}', column === undefined);
  const usable = withoutLine
    ? withoutLineAnchor(withoutTail(columnDropped, '{line}', true))
    : columnDropped;

  const expanded = usable.replace(PLACEHOLDER, (whole, name: string) => {
    if (name === 'ref') return ref ?? whole;
    if (name === 'file') return file === undefined ? whole : encodePath(file);
    if (name === 'absolutePath') {
      return absolutePath === undefined ? whole : encodeAbsolutePath(absolutePath);
    }
    if (name === 'column') return column === undefined ? whole : String(column);

    return line === undefined ? whole : String(line);
  });

  const leftover = ANY_PLACEHOLDER.exec(expanded);
  if (leftover !== null) {
    return { reason: reasonFor(leftover[0], subject, ref) };
  }

  const scheme = schemeOf(expanded);
  if (scheme === undefined) {
    return {
      reason:
        `the source link template expanded to "${expanded}", which is not an absolute URL. ` +
        'SPEC 6.3 links into a repository or into an editor, so the template carries its scheme',
    };
  }

  if (!LINKABLE_SCHEMES.includes(scheme)) {
    return {
      reason:
        `the source link template expanded to the scheme "${scheme}", which SPEC 6.3 does not ` +
        `allow, so ${subject} is not linked. A source link is handed to the browser and, for an ` +
        `editor, on to the operating system, so the schemes are a list: ${LINKABLE_SCHEMES.join(', ')}`,
    };
  }

  return withoutLine ? { url: expanded, withoutLine: true } : { url: expanded };
}

/**
 * Reads a field that is only a fact when it is a positive whole number.
 *
 * @param value - Whatever the location carried, which may have been serialized from elsewhere
 * @returns The number, or undefined when it says nothing
 */
function positiveInteger(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
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
 * Removes a trailing `:{placeholder}` when the fact behind it is missing.
 *
 * THE SAME RULE AS THE LINE ANCHOR, IN THE FORM AN EDITOR URL USES. `vscode://file/{path}:{line}`
 * with the number blanked is `vscode://file/{path}:`, which is a path with a colon on the end and
 * not a file any editor opens. Dropping the segment whole gives a link to the file, and that is
 * the degradation SPEC 6.3 asks for.
 *
 * A PLACEHOLDER ANYWHERE BUT AT THE END IS LEFT ALONE, so the leftover check refuses the template
 * by name. A form that puts the column in the middle of a path is a form this function has never
 * seen, and inventing where its separator ends would be guessing.
 *
 * @param template - The template as it stands
 * @param placeholder - The placeholder, with its braces
 * @param drop - Whether the fact behind it is missing
 * @returns The template without that tail, or unchanged
 */
function withoutTail(template: string, placeholder: string, drop: boolean): string {
  if (!drop) return template;

  const tail = `:${placeholder}`;

  return template.endsWith(tail) ? template.slice(0, -tail.length) : template;
}

/**
 * Encodes a repository relative path for a URL, keeping its separators.
 *
 * `encodeURIComponent` on the whole path would turn every `/` into `%2F` and give one path
 * segment named after the whole file, which no forge resolves. Per segment it is exactly right:
 * a directory called `my orders` becomes `my%20orders` and the path still has its shape.
 *
 * THE COLON IS PUT BACK, AND IT IS THE ONE CHARACTER THAT IS. `encodeURIComponent` escapes it,
 * RFC 3986 admits it in a path segment, and `vscode://file/C:/Users/...` is the documented form of
 * a Windows path in an editor URL. Escaping the drive letter's colon while the template's own
 * `:{line}:{column}` stands unescaped beside it would be one rule applied in two directions.
 *
 * @param file - Path with forward slashes
 * @returns The same path, safe to put in a URL
 */
function encodePath(file: string): string {
  return file
    .split('/')
    .map((segment) => encodeURIComponent(segment).replaceAll('%3A', ':'))
    .join('/');
}

/**
 * Puts an absolute path into the shape an editor URL wants.
 *
 * THE LEADING SLASH GOES AND THAT IS WHAT MAKES ONE TEMPLATE WORK ON BOTH PLATFORMS, per SPEC
 * 6.3. `vscode://file/{absolutePath}` over `/Users/me/a.ts` has to give `vscode://file/Users/me/a.ts`
 * and over `C:\Users\me\a.ts` has to give `vscode://file/C:/Users/me/a.ts`, so the slash after
 * `file` is the path's own and the placeholder never carries a second one.
 *
 * @param path - The absolute path as the locator returned it
 * @returns The same path, in URL terms
 */
function encodeAbsolutePath(path: string): string {
  return encodePath(path.replaceAll('\\', '/').replace(/^\/+/, ''));
}

/**
 * The scheme of an expanded template, when it is an absolute URL at all.
 *
 * @param value - The expanded template
 * @returns The scheme with its colon, such as `https:`, or undefined when it parses against nothing
 */
function schemeOf(value: string): string | undefined {
  try {
    return new URL(value).protocol;
  } catch {
    return undefined;
  }
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

  // A `{line}` OR `{column}` STILL HERE MEANS THE FACT WAS MISSING AND THE PLACEHOLDER WAS SOMEWHERE
  // THIS FUNCTION CANNOT DROP IT FROM. Saying it "is not one of" the five would be a message that
  // contradicts itself, which is what this branch was added to stop.
  if (leftover === '{line}' || leftover === '{column}') {
    return (
      `the source link template holds ${leftover}, nothing resolved a value for it, and it does ` +
      `not stand where SPEC 6.3 drops it from, so ${subject} cannot be linked. A line anchor and ` +
      `a trailing :${leftover} degrade to a link to the file; any other position is a form this ` +
      'expansion has never seen and will not guess at'
    );
  }

  return (
    `the source link template holds ${leftover}, which is not one of {ref}, {file}, {line}, ` +
    `{absolutePath} or {column}, so ${subject} cannot be linked. A link carrying an unfilled ` +
    'placeholder would be clickable and wrong'
  );
}
