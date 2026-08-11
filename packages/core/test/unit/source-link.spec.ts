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

/** The file the fixture location points at, spelled once. */
const FILE = 'examples/nest-minimal/src/orders.controller.ts';

/** What a case may replace, with `undefined` meaning "the field is absent". */
interface LocationOverrides {
  readonly file?: string | undefined;
  readonly line?: number | undefined;
}

/**
 * A located operation, with whatever the case under test needs overridden.
 *
 * SPELLED OUT RATHER THAN SPREAD, because the IR is compiled with
 * `exactOptionalPropertyTypes`: `{ line: undefined }` is a different type from a missing `line`,
 * and it is the missing one every degradation here is about.
 *
 * @param overrides - Fields to replace, where undefined removes the field
 * @returns The location
 */
function location(overrides: LocationOverrides = {}): IRSourceLocation {
  const file = 'file' in overrides ? overrides.file : FILE;
  const line = 'line' in overrides ? overrides.line : 92;

  return {
    controller: 'OrdersController',
    handler: 'list',
    ...(file === undefined ? {} : { file }),
    ...(line === undefined ? {} : { line }),
  };
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

  it('should never return both a url and a reason, or neither', () => {
    // Given the two shapes this function can be in, which callers switch on.
    const cases = [
      expandSourceLink(GITHUB, location(), 'a1b2c3d'),
      expandSourceLink(GITHUB, location({ file: undefined })),
      expandSourceLink(GITHUB, location({ line: undefined }), 'a1b2c3d'),
      expandSourceLink('', location()),
    ];

    // When, Then
    for (const result of cases) {
      expect(result.url === undefined).toBe(result.reason !== undefined);
    }
  });
});
