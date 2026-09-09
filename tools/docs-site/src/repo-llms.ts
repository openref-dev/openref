import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPOSITORY_ROOT } from './index.js';

/**
 * The repository described for a language model: `llms.txt` and `llms-full.txt` at the root.
 *
 * THE SITE'S PAIR AND THIS PAIR DESCRIBE TWO DIFFERENT THINGS AND BOTH SAY WHICH. The files at
 * the root of https://openref.dev describe the API the site renders: routes, operations,
 * schemas. The files at the root of the repository describe the packages: what each one is,
 * where it is published, and the whole of every README in one text, because a reader that
 * follows no link should get the whole picture from one address, and a language model reading
 * a repository is exactly that reader.
 *
 * NOTHING HERE IS A SECOND COPY OF A LIST. The packages are the directories of `packages/`,
 * their names and descriptions are their manifests, their grouping is derived: `private` says
 * internal, the `@openref/collector-` prefix says ecosystem collector, everything else is a
 * published package. The full text is the READMEs verbatim. A hand written package list at the
 * root is how a fourteenth package would go missing from a thirteenth place, per the
 * `publish-list` gate's own history.
 *
 * A PACKAGE WITHOUT A README REFUSES THE BUILD. Every package carries one as of the day this
 * file was written, and the refusal is what keeps that true: a new package cannot enter the
 * root text as a bare name, and cannot silently stay out of it either.
 *
 * `pnpm docs:build` rewrites both files in place; `repo-llms.spec.ts` composes them again and
 * fails when the committed copy has gone stale, so the root text and the packages cannot
 * disagree for longer than one test run.
 */

/** One sentence, the project's own, used as the summary of both files. */
const SUMMARY =
  'NestJS-native API reference engine for HTTP, events and runtime contracts. The ' +
  'specification describes how the API looks, the running NestJS application knows how the ' +
  'API behaves, and OPENREF connects the two.';

/** What one package contributes to the two texts. */
interface DescribedPackage {
  /** Directory name under `packages/`. */
  readonly directory: string;
  /** The npm name, from the manifest. */
  readonly name: string;
  /** The manifest's one line description. */
  readonly description: string;
  /** Whether the manifest says `private`. */
  readonly internal: boolean;
  /** The README, verbatim. */
  readonly readme: string;
}

/** Every package of `packages/`, in directory order, refused loudly when one cannot be read. */
export function describedPackages(): readonly DescribedPackage[] {
  const root = join(REPOSITORY_ROOT, 'packages');

  return readdirSync(root)
    .filter((entry) => existsSync(join(root, entry, 'package.json')))
    .sort()
    .map((directory) => {
      const manifest = JSON.parse(readFileSync(join(root, directory, 'package.json'), 'utf8')) as {
        readonly name?: string;
        readonly description?: string;
        readonly private?: boolean;
      };
      const readmeFile = join(root, directory, 'README.md');
      if (!existsSync(readmeFile)) {
        throw new Error(`packages/${directory} has no README.md, so it cannot be described`);
      }
      if (manifest.name === undefined || manifest.description === undefined) {
        throw new Error(`packages/${directory} names no name or no description in its manifest`);
      }

      return {
        directory,
        name: manifest.name,
        description: manifest.description,
        internal: manifest.private === true,
        readme: readFileSync(readmeFile, 'utf8'),
      };
    });
}

/** One index line: the package, linked to the README that expands it. */
function indexLine(described: DescribedPackage): string {
  return `- [${described.name}](packages/${described.directory}/README.md): ${described.description}`;
}

/**
 * @returns The contents of the root `llms.txt`: the summary and every package, grouped and linked
 */
export function repoLlmsIndex(): string {
  const packages = describedPackages();
  const collectors = packages.filter(
    (p) => !p.internal && p.name.startsWith('@openref/collector-'),
  );
  const published = packages.filter((p) => !p.internal && !collectors.includes(p));
  const internal = packages.filter((p) => p.internal);

  return [
    '# OPENREF',
    '',
    `> ${SUMMARY}`,
    '',
    'The reference this project renders for itself is https://openref.dev, and the same pair of',
    'files at that root describes the API rather than the packages. This pair describes the',
    'repository. The full text of every README below is in llms-full.txt beside this file.',
    '',
    '## Published packages',
    '',
    ...published.map(indexLine),
    '',
    '## Ecosystem collectors',
    '',
    ...collectors.map(indexLine),
    '',
    '## Internal packages, bundled into the published ones',
    '',
    ...internal.map(indexLine),
    '',
  ].join('\n');
}

/**
 * @returns The contents of the root `llms-full.txt`: every README, verbatim, in one text
 */
export function repoLlmsFull(): string {
  const packages = describedPackages();

  return [
    '# OPENREF',
    '',
    `> ${SUMMARY}`,
    '',
    `Every package of the repository in full: the README of each of the ${String(packages.length)},`,
    'verbatim, in directory order. The index beside this file is llms.txt.',
    '',
    ...packages.map((p) => `---\n\n${p.readme.trimEnd()}\n`),
  ].join('\n');
}

/**
 * Writes both files at the repository root, in place.
 *
 * @returns The files that moved, repository relative, the way `writeGeneratedDocumentation` says it
 */
export function writeRepoLlmsTexts(): readonly string[] {
  const moved: string[] = [];

  for (const [file, text] of [
    ['llms.txt', repoLlmsIndex()],
    ['llms-full.txt', repoLlmsFull()],
  ] as const) {
    const path = join(REPOSITORY_ROOT, file);
    const before = existsSync(path) ? readFileSync(path, 'utf8') : undefined;
    if (before !== text) {
      writeFileSync(path, text);
      moved.push(file);
    }
  }

  return moved;
}
