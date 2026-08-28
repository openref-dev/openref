import { describe, expect, it } from 'vitest';
import { expandSourceLink, type IRSourceLocation } from '../../src/index';

/**
 * SPEC 6.3's template expansion, which is the half of the source link that has no machine in it.
 *
 * THE CASES THAT MATTER ARE THE DEGRADATIONS. Producing a GitHub URL from a template and a line
 * number is not where this goes wrong. It goes wrong when the line is missing and the link ends
 * in `#LNaN`, or when the template asks for something that was not resolved and the link is
 * served with a brace still in it: both render as a link, both are clickable, and both land on a
 * 404 the reader blames on the repository.
 */

const GITHUB = 'https://github.com/org/repo/blob/{ref}/{file}#L{line}';
const GITLAB = 'https://gitlab.com/org/repo/-/blob/{ref}/{file}#L{line}';
const BITBUCKET = 'https://bitbucket.org/org/repo/src/{ref}/{file}#lines-{line}';

/** The two editor forms of SPEC 6.3, which are the same template over two more facts. */
const VSCODE = 'vscode://file/{absolutePath}:{line}:{column}';
const JETBRAINS = 'jetbrains://idea/navigate/reference?path=/{absolutePath}:{line}:{column}';

/** The file the fixture location points at, spelled once. */
const FILE = 'examples/nest-minimal/src/orders.controller.ts';

/** Where the same file is on the machine that built the document. */
const ABSOLUTE = `/home/dana/work/openref/${FILE}`;

/** What a case may replace, with `undefined` meaning "the field is absent". */
interface LocationOverrides {
  readonly file?: string | undefined;
  readonly line?: number | undefined;
  readonly absolutePath?: string | undefined;
  readonly column?: number | undefined;
}

/**
 * A located operation, with whatever the case under test needs overridden.
 *
 * SPELLED OUT RATHER THAN SPREAD, because the IR is compiled with
 * `exactOptionalPropertyTypes`: `{ line: undefined }` is a different type from a missing `line`,
 * and it is the missing one every degradation here is about.
 *
 * THE MACHINE HALF IS ABSENT UNLESS A CASE ASKS FOR IT, which is the default this fixture shares
 * with the collector: `absolutePath` and `column` are present only behind the opt in of SPEC 6.3.
 *
 * @param overrides - Fields to replace, where undefined removes the field
 * @returns The location
 */
function location(overrides: LocationOverrides = {}): IRSourceLocation {
  const file = 'file' in overrides ? overrides.file : FILE;
  const line = 'line' in overrides ? overrides.line : 92;
  const absolutePath = overrides.absolutePath;
  const column = overrides.column;

  return {
    controller: 'OrdersController',
    handler: 'list',
    ...(file === undefined ? {} : { file }),
    ...(line === undefined ? {} : { line }),
    ...(absolutePath === undefined ? {} : { absolutePath }),
    ...(column === undefined ? {} : { column }),
  };
}

/** A location as the collector emits it when the host opted in, on the machine that built it. */
function located(overrides: LocationOverrides = {}): IRSourceLocation {
  return location({ absolutePath: ABSOLUTE, column: 3, ...overrides });
}

describe('expandSourceLink', () => {
  it('should expand the GitHub template into a link to the line', () => {
    // Given
    const template = GITHUB;

    // When
    const result = expandSourceLink(template, location(), 'a1b2c3d');

    // Then
    expect(result.url).toBe(
      'https://github.com/org/repo/blob/a1b2c3d/examples/nest-minimal/src/orders.controller.ts#L92',
    );
    expect(result.withoutLine).toBeUndefined();
    expect(result.reason).toBeUndefined();
  });

  it('should expand the GitLab and Bitbucket templates, which differ only in the anchor', () => {
    // Given the three forges T018 names. They are one template with different text around the
    // same three placeholders, which is the reason the expansion is a template at all.
    const ref = 'main';

    // When
    const gitlab = expandSourceLink(GITLAB, location({ line: 7 }), ref);
    const bitbucket = expandSourceLink(BITBUCKET, location({ line: 7 }), ref);

    // Then
    expect(gitlab.url).toBe(
      'https://gitlab.com/org/repo/-/blob/main/examples/nest-minimal/src/orders.controller.ts#L7',
    );
    expect(bitbucket.url).toBe(
      'https://bitbucket.org/org/repo/src/main/examples/nest-minimal/src/orders.controller.ts#lines-7',
    );
  });

  it('should degrade to a file link when the line is unavailable, not emit #LNaN', () => {
    // Given a source the collector located to a file and no further, which is what a build with
    // no source maps produces.
    const found = location({ line: undefined });

    // When
    const result = expandSourceLink(GITHUB, found, 'a1b2c3d');

    // Then
    expect(result.url).toBe(
      'https://github.com/org/repo/blob/a1b2c3d/examples/nest-minimal/src/orders.controller.ts',
    );
    expect(result.url).not.toContain('#');
    expect(result.withoutLine).toBe(true);
  });

  it('should drop the whole anchor rather than leave the text around the line behind', () => {
    // Given Bitbucket's anchor, which is not `#L` and would degrade to `#lines-` if the
    // placeholder alone were blanked. An anchor no page has is a link that silently does nothing.
    const found = location({ line: undefined });

    // When
    const result = expandSourceLink(BITBUCKET, found, 'main');

    // Then
    expect(result.url).toBe(
      'https://bitbucket.org/org/repo/src/main/examples/nest-minimal/src/orders.controller.ts',
    );
  });

  it.each([0, -1, 1.5, Number.NaN])(
    'should treat %s as no line at all rather than putting it in the URL',
    (line: number) => {
      // Given a line that survived serialization from somewhere this package did not write.
      const found: IRSourceLocation = { ...location(), line };

      // When
      const result = expandSourceLink(GITHUB, found, 'a1b2c3d');

      // Then
      expect(result.withoutLine).toBe(true);
      expect(result.url).not.toContain('#');
    },
  );

  it('should refuse to link when there is no file', () => {
    // Given a source the collector named but could not locate at all.
    const found = location({ file: undefined, line: undefined });

    // When
    const result = expandSourceLink(GITHUB, found, 'a1b2c3d');

    // Then
    expect(result.url).toBeUndefined();
    expect(result.reason).toContain('OrdersController.list');
    expect(result.reason).toContain('nothing to');
  });

  it('should refuse to link when the template needs a ref and none was resolved', () => {
    // Given a build with no `.git`, which is every Docker image built from a copied tree.
    // When
    const result = expandSourceLink(GITHUB, location());

    // Then
    expect(result.url).toBeUndefined();
    expect(result.reason).toContain('{ref}');
    expect(result.reason).toContain('sourceLink: { template, ref }');
  });

  it('should refuse a template holding a placeholder it cannot fill', () => {
    // Given somebody's own forge, whose URL wants something this function has never heard of. A
    // link with `{project}` still in it is clickable and wrong, which is worse than no link.
    const template = 'https://forge.example/{project}/blob/{ref}/{file}#L{line}';

    // When
    const result = expandSourceLink(template, location(), 'a1b2c3d');

    // Then
    expect(result.url).toBeUndefined();
    expect(result.reason).toContain('{project}');
  });

  it('should refuse a template that expands to something which is not a URL', () => {
    // Given a relative template. SPEC 6.3 links into a repository, so a link with no host would
    // resolve against whatever page is showing the reference.
    const template = '/blob/{ref}/{file}#L{line}';

    // When
    const result = expandSourceLink(template, location(), 'a1b2c3d');

    // Then
    expect(result.url).toBeUndefined();
    expect(result.reason).toContain('absolute URL');
  });

  it('should refuse an empty template rather than producing a link to the ref', () => {
    // Given a host that configured no template at all.
    // When
    const result = expandSourceLink('', location(), 'a1b2c3d');

    // Then
    expect(result.url).toBeUndefined();
    expect(result.reason).toContain('no source link template');
  });

  it('should encode a path segment without turning the separators into escapes', () => {
    // Given a directory with a space in it, which no forge resolves as `%2F` joined text.
    const found = location({ file: 'packages/my orders/src/a.ts' });

    // When
    const result = expandSourceLink(GITHUB, found, 'a1b2c3d');

    // Then
    expect(result.url).toBe(
      'https://github.com/org/repo/blob/a1b2c3d/packages/my%20orders/src/a.ts#L92',
    );
  });

  it('should expand the editor form from the located position, with no ref and no repository', () => {
    // Given a handler located on the machine that built the document, and a host that asked for
    // the absolute path. No git revision is passed at all, which is the point of the editor form.
    const found = located({ file: undefined });

    // When
    const result = expandSourceLink(VSCODE, found);

    // Then the leading slash is the one already in the template, so a reader gets a path their
    // own editor resolves rather than a doubled root
    expect(result.url).toBe(
      'vscode://file/home/dana/work/openref/examples/nest-minimal/src/orders.controller.ts:92:3',
    );
    expect(result.reason).toBeUndefined();
    expect(result.withoutLine).toBeUndefined();
  });

  it('should expand the JetBrains form, which carries the path in a query parameter', () => {
    // Given the second editor form SPEC 6.3 names, riding the Toolbox protocol handler.
    // When
    const result = expandSourceLink(JETBRAINS, located());

    // Then
    expect(result.url).toBe(
      'jetbrains://idea/navigate/reference?path=/home/dana/work/openref/' +
        'examples/nest-minimal/src/orders.controller.ts:92:3',
    );
  });

  it('should drop the trailing column when no column was resolved, not write 1', () => {
    // Given a map that gave a line and no column. Writing 1 would put the caret somewhere the map
    // never claimed, which is the guess SPEC 6.1 refuses.
    const found = located({ column: undefined });

    // When
    const result = expandSourceLink(VSCODE, found);

    // Then
    expect(result.url).toBe(
      'vscode://file/home/dana/work/openref/examples/nest-minimal/src/orders.controller.ts:92',
    );
    expect(result.url).not.toContain('NaN');
    expect(result.withoutLine).toBeUndefined();
  });

  it('should degrade the editor form to the file when neither line nor column is known', () => {
    // Given the editor equivalent of a forge link losing its anchor: a file link still opens the
    // file, and `vscode://file/...:` opens nothing.
    const found = located({ line: undefined, column: undefined });

    // When
    const result = expandSourceLink(VSCODE, found);

    // Then
    expect(result.url).toBe(
      'vscode://file/home/dana/work/openref/examples/nest-minimal/src/orders.controller.ts',
    );
    expect(result.url?.endsWith(':')).toBe(false);
    expect(result.withoutLine).toBe(true);
  });

  it('should refuse a column the template puts anywhere but at the end', () => {
    // Given a form this expansion has never seen. Dropping a placeholder from the middle of a
    // path means guessing where its separator ends, and the guess is what produces a clickable
    // wrong link.
    const template = 'vscode://file/{absolutePath}?col={column}&x=1';

    // When
    const result = expandSourceLink(template, located({ column: undefined }));

    // Then
    expect(result.url).toBeUndefined();
    expect(result.reason).toContain('{column}');
    expect(result.reason).not.toContain('is not one of');
  });

  it('should refuse the editor form when the host did not opt in to the absolute path', () => {
    // Given the default: the collector located the handler and threw the machine's path away,
    // which is what a document served to a team carries.
    const found = location();

    // When
    const result = expandSourceLink(VSCODE, found);

    // Then the reader is told which option is missing rather than shown a link with a brace in it
    expect(result.url).toBeUndefined();
    expect(result.reason).toContain('{absolutePath}');
    expect(result.reason).toContain('sourceCollector({ absolutePath: true })');
    expect(result.reason).toContain('OrdersController.list');
  });

  it('should turn a Windows path into one URL path, keeping the drive letter', () => {
    // Given the other platform. One template has to work on both, which is why `{absolutePath}`
    // carries no leading slash: `vscode://file/` supplies it and the drive letter follows.
    const found = located({ file: undefined, absolutePath: 'C:\\Users\\dana\\src\\a.ts' });

    // When
    const result = expandSourceLink(VSCODE, found);

    // Then
    expect(result.url).toBe('vscode://file/C:/Users/dana/src/a.ts:92:3');
  });

  it('should encode an absolute path segment rather than let it end the URL early', () => {
    // Given a directory whose name carries characters a URL reads as structure. Unescaped, `#`
    // ends the path and everything after it becomes a fragment the editor never sees.
    const found = located({ file: undefined, absolutePath: '/home/dana/my work/a#b/c.ts' });

    // When
    const result = expandSourceLink(VSCODE, found);

    // Then
    expect(result.url).toBe('vscode://file/home/dana/my%20work/a%23b/c.ts:92:3');
  });

  it.each(['javascript:alert(1)//{file}', 'ftp://forge.example/{file}#L{line}'])(
    'should refuse the scheme in %s rather than putting it in an href',
    (template: string) => {
      // Given a template that reached this function from a document. `sourceLinkTemplate` is a
      // field of the IR, and a document arrives from a file, from the CLI and, from M4, from a
      // remote, so the scheme is checked rather than trusted.
      // When
      const result = expandSourceLink(template, located(), 'a1b2c3d');

      // Then
      expect(result.url).toBeUndefined();
      expect(result.reason).toContain('SPEC 6.3 does not');
      expect(result.reason).toContain('vscode:');
    },
  );

  it('should refuse a template that names no path at all', () => {
    // Given a template every operation would expand to the same way. It renders as a working
    // source link and is not one.
    const template = 'https://github.com/org/repo/tree/{ref}';

    // When
    const result = expandSourceLink(template, located(), 'a1b2c3d');

    // Then
    expect(result.url).toBeUndefined();
    expect(result.reason).toContain('neither {file} nor {absolutePath}');
  });

  it('should never return both a url and a reason, or neither', () => {
    // Given the two shapes this function can be in, which callers switch on.
    const cases = [
      expandSourceLink(GITHUB, location(), 'a1b2c3d'),
      expandSourceLink(GITHUB, location({ file: undefined })),
      expandSourceLink(GITHUB, location({ line: undefined }), 'a1b2c3d'),
      expandSourceLink('', location()),
      expandSourceLink(VSCODE, located()),
      expandSourceLink(VSCODE, location()),
      expandSourceLink(VSCODE, located({ line: undefined, column: undefined })),
      expandSourceLink(JETBRAINS, located({ file: undefined })),
      expandSourceLink('javascript:alert(1)//{file}', located()),
      expandSourceLink('https://github.com/org/repo/tree/{ref}', located(), 'a1b2c3d'),
    ];

    // When, Then
    for (const result of cases) {
      expect(result.url === undefined).toBe(result.reason !== undefined);
    }
  });
});
