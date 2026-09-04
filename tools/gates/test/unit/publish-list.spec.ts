import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { PUBLISHED_PACKAGES } from '../../src/config';
import { UNREACHABLE_REGISTRY } from '../../src/gates/publish-list.gate';
import { runCommand } from '../../src/lib/exec';
import {
  auditChangesetGroups,
  auditHeldBack,
  auditPublishedDelivery,
  auditPublishList,
  auditSpecAgreement,
  CLAUDE_LIST_HEADINGS,
  parseDryRun,
  parseRepositorySlug,
  readSpecPackageLists,
  repositoryUrlOf,
  resolveBuildRepository,
  SPEC_LIST_HEADINGS,
  type BuildRepository,
} from '../../src/lib/publish-list';
import type { WorkspaceManifest } from '../../src/lib/workspace';
import { SPAWNED_PROCESS_TIMEOUT_MS } from '../../../../vitest.spawn-timeout.ts';

/**
 * The suite the `publish-list` gate did not have.
 *
 * IT SHIPPED WITH NO UNIT FILE AT ALL and no case anywhere else, which is what let two of its own
 * branches be wrong in ways nothing could see: a comparison against the `private` marking that no
 * tree could redden, and a header claiming a case in the integration suite pinned its no network
 * property when no such case existed. Every direction of every comparison is asked here, and every
 * red class is reddened, because a gate whose failures are never exercised is a gate that reports
 * the absence of failures it cannot produce.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/** The repository this test tree stands in, for the delivery cases that need one. */
const HERE: BuildRepository = { slug: 'openref-dev/openref', source: 'a fixture' };

let temporary = '';

afterEach(() => {
  if (temporary !== '') rmSync(temporary, { recursive: true, force: true });
  temporary = '';
});

/**
 * A manifest as `readWorkspaceManifests` reports one.
 *
 * @param name - Package name
 * @param isPrivate - Whether it sets `private: true`
 * @returns The manifest
 */
function manifest(name: string, isPrivate: boolean): WorkspaceManifest {
  return {
    directory: `packages/${name.replace('@openref/', '')}`,
    name,
    isPrivate,
    dependencies: [],
    developmentDependencies: [],
  };
}

/** What a published manifest holds, so a case can break exactly one field. */
interface Delivery {
  readonly license?: string;
  readonly repositoryUrl?: string;
  readonly bugsUrl?: string;
  readonly access?: string;
  readonly licenceText?: string | null;
}

/**
 * Builds a repository tree with one published package in it.
 *
 * @param name - Package name
 * @param delivery - Fields to override, absent meaning the correct value
 * @returns The absolute root of the tree
 */
function treeWith(name: string, delivery: Delivery = {}): string {
  temporary = mkdtempSync(join(tmpdir(), 'openref-publish-list-'));
  writeFileSync(join(temporary, 'LICENSE'), 'MIT License\n\nCopyright\n');

  const directory = join(temporary, manifest(name, false).directory);
  mkdirSync(directory, { recursive: true });

  const text =
    delivery.licenceText === undefined ? 'MIT License\n\nCopyright\n' : delivery.licenceText;
  if (text !== null) writeFileSync(join(directory, 'LICENSE'), text);

  writeFileSync(
    join(directory, 'package.json'),
    JSON.stringify({
      name,
      license: delivery.license ?? 'MIT',
      repository: { url: delivery.repositoryUrl ?? repositoryUrlOf(HERE.slug ?? '') },
      bugs: { url: delivery.bugsUrl ?? `https://github.com/${HERE.slug ?? ''}/issues` },
      publishConfig: { access: delivery.access ?? 'public' },
    }),
  );

  return temporary;
}

/**
 * The error messages out of a set of findings.
 *
 * @param findings - What an audit produced
 * @returns One string per error
 */
function errorsOf(findings: readonly { readonly level: string; readonly message: string }[]) {
  return findings.filter((finding) => finding.level === 'error').map((finding) => finding.message);
}

describe('parseDryRun', () => {
  it('should read one name per package line pnpm prints', () => {
    // Given
    const output = [
      'packages/core                | [WARN] something',
      '📦 @openref/core@1.2.3 → https://registry.npmjs.org/',
      '[WARN] Skip publishing @openref/core@1.2.3 (dry run)',
      '📦 openref@1.2.3 → https://registry.npmjs.org/',
    ].join('\n');

    // When
    const names = parseDryRun(output);

    // Then
    expect(names).toEqual(['@openref/core', 'openref']);
  });

  it('should read nothing from output that names no package', () => {
    // Given
    const output = 'Scope: all 19 workspace projects\nNothing to publish\n';

    // When
    const names = parseDryRun(output);

    // Then
    expect(names).toEqual([]);
  });
});

describe('parseRepositorySlug', () => {
  it.each([
    ['git@github.com:openref-dev/openref.git', 'openref-dev/openref'],
    ['https://github.com/openref-dev/openref.git', 'openref-dev/openref'],
    ['https://github.com/openref-dev/openref', 'openref-dev/openref'],
    ['ssh://git@github.com/openref-dev/openref.git', 'openref-dev/openref'],
    ['openref-dev/openref', 'openref-dev/openref'],
  ])('should read %s as %s', (remote, expected) => {
    // When
    const slug = parseRepositorySlug(remote);

    // Then
    expect(slug).toBe(expected);
  });

  it.each([['https://gitlab.com/openref-dev/openref.git'], [''], ['not a url at all']])(
    'should read nothing out of %s, which is not a GitHub repository',
    (remote) => {
      // When
      const slug = parseRepositorySlug(remote);

      // Then
      expect(slug).toBeNull();
    },
  );
});

describe('resolveBuildRepository', () => {
  it('should prefer GITHUB_REPOSITORY, which is the repository a workflow attests against', () => {
    // Given, a runner sets the variable and also has an origin remote; the variable is the one
    // npm's provenance statement will name.
    // When
    const resolved = resolveBuildRepository(
      'openref-dev/openref',
      'git@github.com:someone/fork.git',
    );

    // Then
    expect(resolved.slug).toBe('openref-dev/openref');
    expect(resolved.source).toBe('GITHUB_REPOSITORY');
  });

  it('should fall back to the origin remote off a runner', () => {
    // When
    const resolved = resolveBuildRepository(undefined, 'git@github.com:openref-dev/openref.git');

    // Then
    expect(resolved.slug).toBe('openref-dev/openref');
    expect(resolved.source).toContain('origin remote');
  });

  it('should say why it could not answer rather than returning a guess, with no remote', () => {
    // When
    const resolved = resolveBuildRepository(undefined, null);

    // Then
    expect(resolved.slug).toBeNull();
    expect(resolved.source).toContain('no git repository or no origin remote');
  });

  it('should say why it could not answer when GITHUB_REPOSITORY is not an owner/name pair', () => {
    // When
    const resolved = resolveBuildRepository('nonsense', null);

    // Then
    expect(resolved.slug).toBeNull();
    expect(resolved.source).toContain('nonsense');
  });

  it('should say why it could not answer when origin is not GitHub', () => {
    // When
    const resolved = resolveBuildRepository(
      undefined,
      'https://gitlab.com/openref-dev/openref.git',
    );

    // Then
    expect(resolved.slug).toBeNull();
    expect(resolved.source).toContain('not a GitHub repository');
  });
});

describe('auditPublishList', () => {
  it('should report a dry run that named nothing rather than reading it as an empty set', () => {
    // Given
    const intended = ['@openref/core'];

    // When
    const findings = auditPublishList([], intended, [manifest('@openref/core', false)]);

    // Then
    expect(errorsOf(findings)).toEqual([
      expect.stringContaining('named no package at all') as unknown as string,
    ]);
  });

  it('should pass when the dry run names exactly the intended set', () => {
    // Given
    const intended = ['@openref/core', 'openref'];

    // When
    const findings = auditPublishList(['@openref/core', 'openref'], intended, [
      manifest('@openref/core', false),
      manifest('openref', false),
    ]);

    // Then
    expect(errorsOf(findings)).toEqual([]);
    expect(findings[0]?.level).toBe('info');
  });

  it('should redden on an internal package that lost its private marking, which is the live case', () => {
    // Given, this is the failure BUILD.md T064 names by hand, and it is the shape it actually
    // takes: a manifest that is publishable because nothing marks it otherwise.
    const intended = ['@openref/core'];

    // When
    const findings = auditPublishList(['@openref/core', '@openref/render'], intended, [
      manifest('@openref/core', false),
      manifest('@openref/render', false),
    ]);

    // Then
    const errors = errorsOf(findings);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('@openref/render is internal by the intended set');
    expect(errors[0]).toContain('does not set private: true');
  });

  it('should redden and name the contradiction when a marked package is emitted anyway', () => {
    // Given, the previous check asked this question of the marking alone, so it could never fire:
    // pnpm skips a private package by its own rule. Asked of the intended set it fires, and the
    // marking becomes the diagnosis instead of the condition.
    const intended = ['@openref/core'];

    // When
    const findings = auditPublishList(['@openref/core', '@openref/render'], intended, [
      manifest('@openref/core', false),
      manifest('@openref/render', true),
    ]);

    // Then
    const errors = errorsOf(findings);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('does set private: true');
    expect(errors[0]).toContain('emitted a package its own rule says it would skip');
  });

  it('should redden on a name the dry run emits that is no workspace package', () => {
    // Given
    const intended = ['@openref/core'];

    // When
    const findings = auditPublishList(['@openref/core', '@openref/ghost'], intended, [
      manifest('@openref/core', false),
    ]);

    // Then
    expect(errorsOf(findings)[0]).toContain('not a workspace package at all');
  });

  it('should redden in the other direction, on an intended package marked private', () => {
    // Given
    const intended = ['@openref/core', '@openref/runner'];

    // When
    const findings = auditPublishList(['@openref/core'], intended, [
      manifest('@openref/core', false),
      manifest('@openref/runner', true),
    ]);

    // Then
    const errors = errorsOf(findings);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('@openref/runner is in the intended set');
    expect(errors[0]).toContain('sets private: true, so pnpm will never publish it');
  });

  it('should redden on an intended package that is not a workspace package', () => {
    // Given
    const intended = ['@openref/core', '@openref/ghost'];

    // When
    const findings = auditPublishList(['@openref/core'], intended, [
      manifest('@openref/core', false),
    ]);

    // Then
    expect(errorsOf(findings)[0]).toContain('not a workspace package');
  });

  it('should redden on an intended package missing for no reason its manifest gives', () => {
    // Given, the package is public and still absent from the dry run, so the diagnosis is silence
    // rather than a wrong guess.
    const intended = ['@openref/core', '@openref/vue'];

    // When
    const findings = auditPublishList(['@openref/core'], intended, [
      manifest('@openref/core', false),
      manifest('@openref/vue', false),
    ]);

    // Then
    const errors = errorsOf(findings);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBe(
      '@openref/vue is in the intended set and the publish dry run would not publish it.',
    );
  });
});

describe('readSpecPackageLists', () => {
  const document = [
    '## Packages',
    '',
    '### Published packages',
    '',
    '| Package | Purpose |',
    '| --- | --- |',
    '| `@openref/nest` | Main entry |',
    '| `openref` | CLI |',
    '',
    '### Internal packages (not published, bundled)',
    '',
    '`render`, `search`.',
    '',
    'A paragraph that mentions `@openref/nest` and must not be read as the list.',
    '',
    '### Packages held back from 1.0',
    '',
    '`@openref/nuxt` ships after 1.0, for a named licence reason.',
    '',
    'A paragraph about `@openref/static` that is not the list and must not be read as one.',
    '',
    '### Ecosystem packages (separate, from M1)',
    '',
    '`@openref/collector-casl`. The contract is public.',
    '',
    '## Something else',
  ].join('\n');

  it('should read the four lists CLAUDE.md states, scoping the internal names', () => {
    // When
    const lists = readSpecPackageLists(document, CLAUDE_LIST_HEADINGS);

    // Then
    expect(lists.published).toEqual(['@openref/nest', 'openref']);
    expect(lists.internal).toEqual(['@openref/render', '@openref/search']);
    expect(lists.ecosystem).toEqual(['@openref/collector-casl']);
    expect(lists.heldBack).toEqual(['@openref/nuxt']);
  });

  it('should read nothing where the heading is absent rather than reading the wrong section', () => {
    // When
    const lists = readSpecPackageLists(document, SPEC_LIST_HEADINGS);

    // Then
    expect(lists.published).toEqual([]);
    expect(lists.internal).toEqual([]);
    expect(lists.ecosystem).toEqual([]);
    expect(lists.heldBack).toEqual([]);
  });
});

describe('auditSpecAgreement', () => {
  const lists = {
    published: ['@openref/core', 'openref'],
    internal: ['@openref/render'],
    ecosystem: ['@openref/collector-casl'],
    heldBack: [],
  };

  it('should pass when the document and the constant name the same set', () => {
    // When
    const findings = auditSpecAgreement(
      ['@openref/collector-casl', '@openref/core', 'openref'],
      lists,
    );

    // Then
    expect(errorsOf(findings)).toEqual([]);
  });

  it('should redden when the document lists a name the constant does not', () => {
    // When
    const findings = auditSpecAgreement(['@openref/core', 'openref'], lists);

    // Then
    expect(errorsOf(findings)).toEqual([
      'SPEC 4 lists @openref/collector-casl as published and PUBLISHED_PACKAGES does not',
    ]);
  });

  it('should redden when the constant names one the document lists nowhere, under its own label', () => {
    // Given, the label is a parameter so a failure names the file to open, since four documents
    // state this set.
    // When
    const findings = auditSpecAgreement(
      ['@openref/collector-casl', '@openref/core', '@openref/theme-kit', 'openref'],
      lists,
      'CLAUDE.md',
    );

    // Then
    expect(errorsOf(findings)).toEqual([
      'PUBLISHED_PACKAGES names @openref/theme-kit and CLAUDE.md lists it nowhere as published',
    ]);
  });

  it('should redden on a name that is internal and published at once', () => {
    // When
    const findings = auditSpecAgreement(
      ['@openref/collector-casl', '@openref/core', '@openref/render', 'openref'],
      lists,
    );

    // Then
    expect(errorsOf(findings)).toContain(
      "@openref/render is in SPEC 4's internal list and in the intended published set at once",
    );
  });

  it('should report an empty published table rather than comparing against nothing', () => {
    // When
    const findings = auditSpecAgreement(['@openref/core'], { ...lists, published: [] });

    // Then
    expect(errorsOf(findings)).toEqual([
      expect.stringContaining('was not found or held no package name') as unknown as string,
    ]);
  });
});

describe('auditHeldBack', () => {
  const nuxt = {
    name: '@openref/nuxt',
    reason: 'a peer drags six licences into zone 1',
    until: 'after 1.0',
  };
  const manifests = [manifest('@openref/nuxt', true), manifest('@openref/core', false)];
  const stated = [
    { document: 'SPEC 4', names: ['@openref/nuxt'] },
    { document: 'CLAUDE.md', names: ['@openref/nuxt'] },
  ];

  it('should pass when the registry, the manifests, the dry run and both documents agree', () => {
    // When
    const findings = auditHeldBack([nuxt], ['@openref/core'], ['@openref/core'], manifests, stated);

    // Then, and the info line carries the release, because "held back" without one is the absence
    // the registry exists to replace.
    expect(findings.every((finding) => finding.level === 'info')).toBe(true);
    expect(findings[0]?.message).toContain('@openref/nuxt until after 1.0');
  });

  it('should go red when the held back package is not a workspace package at all', () => {
    // When
    const findings = auditHeldBack([nuxt], ['@openref/core'], ['@openref/core'], [], stated);

    // Then
    expect(findings.some((finding) => finding.level === 'error')).toBe(true);
    expect(findings[0]?.message).toContain('this workspace has no such package');
  });

  it('should go red when the held back package is not private, because a release would publish it', () => {
    // Given the one marking that decides what `pnpm publish` emits, taken off
    const publishable = [manifest('@openref/nuxt', false)];

    // When
    const findings = auditHeldBack(
      [nuxt],
      ['@openref/core'],
      ['@openref/core'],
      publishable,
      stated,
    );

    // Then
    expect(findings.some((finding) => finding.message.includes('does not set private: true'))).toBe(
      true,
    );
  });

  it('should go red when a held back package is also in the intended published set', () => {
    // When
    const findings = auditHeldBack([nuxt], ['@openref/nuxt'], [], manifests, stated);

    // Then
    expect(
      findings.some((finding) => finding.message.includes('two answers to one question')),
    ).toBe(true);
  });

  it('should go red when the dry run would publish a package the registry holds back', () => {
    // When, asking the command a release runs rather than the marking, which is the whole reason
    // the dry run is in this gate at all
    const findings = auditHeldBack([nuxt], ['@openref/core'], ['@openref/nuxt'], manifests, stated);

    // Then
    expect(
      findings.some((finding) => finding.message.includes('the publish dry run would publish it')),
    ).toBe(true);
  });

  it('should go red when a document holds a package back and the registry does not', () => {
    // When
    const findings = auditHeldBack([], ['@openref/core'], [], manifests, stated);

    // Then, twice, once per document, because a reader fixes the file they are looking at
    const unenforced = findings.filter((finding) =>
      finding.message.includes('so nothing enforces it'),
    );
    expect(unenforced).toHaveLength(2);
    expect(unenforced[0]?.message).toContain('SPEC 4');
    expect(unenforced[1]?.message).toContain('CLAUDE.md');
  });

  it('should go red when the registry holds a package back and a document does not say so', () => {
    // Given one document that carries the section and one that does not
    const half = [
      { document: 'SPEC 4', names: ['@openref/nuxt'] },
      { document: 'CLAUDE.md', names: [] },
    ];

    // When
    const findings = auditHeldBack([nuxt], ['@openref/core'], ['@openref/core'], manifests, half);

    // Then the document that is silent is named, and the one that is not is not
    const silent = findings.filter((finding) => finding.message.includes('does not say so'));
    expect(silent).toHaveLength(1);
    expect(silent[0]?.message).toContain('CLAUDE.md');
  });

  it('should go red on an entry that names no reason or no release', () => {
    // Given an entry that says only "not yet", which is the absence it was written to replace
    const bare = { name: '@openref/nuxt', reason: '  ', until: 'after 1.0' };

    // When
    const findings = auditHeldBack([bare], ['@openref/core'], ['@openref/core'], manifests, stated);

    // Then
    expect(findings.some((finding) => finding.message.includes('no reason or no release'))).toBe(
      true,
    );
  });

  it('should say so rather than pass when nothing is held back and no document says otherwise', () => {
    // Given, When: the empty registry, which is a legitimate state and must not read as a check
    const findings = auditHeldBack([], ['@openref/core'], ['@openref/core'], manifests, [
      { document: 'SPEC 4', names: [] },
    ]);

    // Then
    expect(findings).toHaveLength(1);
    expect(findings[0]?.level).toBe('info');
    expect(findings[0]?.message).toContain('no package is held back');
  });
});

describe('auditChangesetGroups', () => {
  const manifests = [
    manifest('@openref/core', false),
    manifest('@openref/runner', false),
    manifest('@openref/action', true),
  ];

  it('should pass when every published name is in a fixed group', () => {
    // When
    const findings = auditChangesetGroups(
      { fixed: [['@openref/core', '@openref/runner', '@openref/action']] },
      ['@openref/core', '@openref/runner'],
      manifests,
    );

    // Then
    expect(errorsOf(findings)).toEqual([]);
  });

  it('should redden on a published package left out of every group', () => {
    // Given, this is the drift that was there: three packages published and none of them added.
    // When
    const findings = auditChangesetGroups(
      { fixed: [['@openref/core']] },
      ['@openref/core', '@openref/runner'],
      manifests,
    );

    // Then
    expect(errorsOf(findings)).toEqual([
      expect.stringContaining(
        '@openref/runner is in the published table and in no fixed group',
      ) as unknown as string,
    ]);
  });

  it('should redden on a group naming a package this workspace does not have', () => {
    // When
    const findings = auditChangesetGroups(
      { fixed: [['@openref/core', '@openref/runner', '@openref/gone']] },
      ['@openref/core', '@openref/runner'],
      manifests,
    );

    // Then
    expect(errorsOf(findings)).toEqual([
      expect.stringContaining('@openref/gone') as unknown as string,
    ]);
  });

  it('should redden when there is no config at all rather than passing on an absent one', () => {
    // When
    const findings = auditChangesetGroups({}, ['@openref/core'], manifests);

    // Then
    expect(errorsOf(findings)).toHaveLength(1);
  });

  it('should report an empty table rather than comparing against nothing', () => {
    // When
    const findings = auditChangesetGroups({ fixed: [['@openref/core']] }, [], manifests);

    // Then
    expect(errorsOf(findings)).toEqual([
      expect.stringContaining('compared against nothing') as unknown as string,
    ]);
  });
});

describe('auditPublishedDelivery', () => {
  it('should pass on a package carrying the licence, the repository, the tracker and the access', () => {
    // Given
    const root = treeWith('@openref/core');

    // When
    const findings = auditPublishedDelivery(
      root,
      [manifest('@openref/core', false)],
      ['@openref/core'],
      HERE,
    );

    // Then
    expect(errorsOf(findings)).toEqual([]);
  });

  it('should redden when the repository root has no LICENSE to compare against', () => {
    // Given
    const root = treeWith('@openref/core');
    rmSync(join(root, 'LICENSE'));

    // When
    const findings = auditPublishedDelivery(
      root,
      [manifest('@openref/core', false)],
      ['@openref/core'],
      HERE,
    );

    // Then
    expect(errorsOf(findings)).toEqual([
      expect.stringContaining('the repository root has no LICENSE') as unknown as string,
    ]);
  });

  it('should redden on a package that ships no LICENSE beside its files', () => {
    // Given
    const root = treeWith('@openref/core', { licenceText: null });

    // When
    const findings = auditPublishedDelivery(
      root,
      [manifest('@openref/core', false)],
      ['@openref/core'],
      HERE,
    );

    // Then
    expect(errorsOf(findings)[0]).toContain('ships no LICENSE file');
  });

  it('should redden on a LICENSE that is not the repository text, which presence alone would pass', () => {
    // Given
    const root = treeWith('@openref/core', { licenceText: 'See the repository for terms.\n' });

    // When
    const findings = auditPublishedDelivery(
      root,
      [manifest('@openref/core', false)],
      ['@openref/core'],
      HERE,
    );

    // Then
    expect(errorsOf(findings)[0]).toContain("not the repository's own text");
  });

  it('should redden on a manifest that does not declare MIT', () => {
    // Given
    const root = treeWith('@openref/core', { license: 'Apache-2.0' });

    // When
    const findings = auditPublishedDelivery(
      root,
      [manifest('@openref/core', false)],
      ['@openref/core'],
      HERE,
    );

    // Then
    expect(errorsOf(findings)[0]).toContain('does not declare MIT');
  });

  it('should redden on a repository field naming somewhere other than where the build runs', () => {
    // Given, this is the release blocker: npm attests provenance against the building repository,
    // so a manifest naming another address is refused rather than published unattested.
    const root = treeWith('@openref/core', {
      repositoryUrl: 'git+https://github.com/openref/openref.git',
    });

    // When
    const findings = auditPublishedDelivery(
      root,
      [manifest('@openref/core', false)],
      ['@openref/core'],
      HERE,
    );

    // Then
    const errors = errorsOf(findings);
    expect(errors[0]).toContain('git+https://github.com/openref/openref.git');
    expect(errors[0]).toContain('openref-dev/openref');
  });

  it('should redden on a bugs address pointing at another repository', () => {
    // Given
    const root = treeWith('@openref/core', {
      bugsUrl: 'https://github.com/openref/openref/issues',
    });

    // When
    const findings = auditPublishedDelivery(
      root,
      [manifest('@openref/core', false)],
      ['@openref/core'],
      HERE,
    );

    // Then
    expect(errorsOf(findings)[0]).toContain('send its readers somewhere else');
  });

  it('should redden on a scoped package whose first publish would be private', () => {
    // Given
    const root = treeWith('@openref/core', { access: 'restricted' });

    // When
    const findings = auditPublishedDelivery(
      root,
      [manifest('@openref/core', false)],
      ['@openref/core'],
      HERE,
    );

    // Then
    expect(errorsOf(findings)[0]).toContain('publishConfig.access');
  });

  it('should redden when the build repository could not be read, rather than passing silently', () => {
    // Given, a null is a reason to say the question could not be asked, never a clean answer.
    const root = treeWith('@openref/core');

    // When
    const findings = auditPublishedDelivery(
      root,
      [manifest('@openref/core', false)],
      ['@openref/core'],
      {
        slug: null,
        source: 'this checkout has no git repository or no origin remote',
      },
    );

    // Then
    expect(errorsOf(findings)[0]).toContain('could not be read');
  });

  it('should redden on an intended name that is no workspace package at all', () => {
    // Given
    const root = treeWith('@openref/core');

    // When
    const findings = auditPublishedDelivery(
      root,
      [manifest('@openref/core', false)],
      ['@openref/ghost'],
      HERE,
    );

    // Then
    expect(errorsOf(findings)).toContain(
      '@openref/ghost is in the intended published set and is not a workspace package',
    );
    expect(errorsOf(findings)).toContain(
      'no published package was checked for delivery, so nothing was proved',
    );
  });
});

describe('the dry run this gate shells out to', () => {
  it(
    'should name every published package from a dry run that could not have reached a registry',
    () => {
      // Given, the gate makes no external request, and this is the measurement rather than the
      // claim: the registry is pointed at an address nothing answers on, so a run that needed one
      // would fail here instead of reaching it. THE ADDRESS IS THE GATE'S OWN CONSTANT rather than
      // a copy, so this case cannot prove a property of a command only this file composes.
      // When
      const result = runCommand(
        'pnpm',
        ['-r', 'publish', '--dry-run', '--no-git-checks'],
        repoRoot,
        {
          npm_config_registry: UNREACHABLE_REGISTRY,
        },
      );

      // Then
      expect(UNREACHABLE_REGISTRY).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
      expect(result.ok).toBe(true);
      expect(parseDryRun(`${result.stdout}\n${result.stderr}`)).toEqual([...PUBLISHED_PACKAGES]);
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it('should be the variable the gate hands the child, not one the child would ignore', () => {
    // Given, the case above runs the command with the gate's constant, which ties the address. What
    // is left to tie is the key it arrives under, since an env variable pnpm does not read would
    // leave the run reaching a real registry while every assertion above still passed.
    const source = readFileSync(
      join(repoRoot, 'tools/gates/src/gates/publish-list.gate.ts'),
      'utf8',
    );

    // Then
    expect(source).toContain('npm_config_registry: UNREACHABLE_REGISTRY');
  });
});
