import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { documentationSpecification, REPOSITORY_ROOT, siteLlmsFullText } from './index.js';
import { writeGeneratedDocumentation } from './generate.js';

/**
 * `pnpm docs:build`: composes the documentation site's document and hands it to the product.
 *
 * IT SPAWNS THE BUILT BINARY RATHER THAN CALLING THE LIBRARY, for the reason the CLI's own
 * binary suite exists: a build that goes through the shipped entry point is the build a reader
 * can reproduce, and one that goes through an import is a build only this repository can run.
 *
 * @returns The process exit code the CLI returned
 */
export function buildDocumentationSite(): number {
  const outputDirectory = join(REPOSITORY_ROOT, 'docs', 'dist');
  const binary = join(REPOSITORY_ROOT, 'packages', 'cli', 'dist', 'bin.js');

  // THE COMPOSED DOCUMENT IS NOT WRITTEN INTO THE OUTPUT DIRECTORY. The build removes files a
  // previous build wrote and nothing else, so a source file living inside its own output is one
  // rule away from being treated as a stale page.
  const specificationFile = join(
    mkdtempSync(join(tmpdir(), 'openref-docs-site-')),
    'openref.site.json',
  );

  // THE GENERATION IS PART OF THE BUILD, which is what makes a stale region unable to ship: a
  // reader who runs the documented command gets the expanded prose, and the suite that runs the
  // same expansion and refuses a change catches anyone who did not.
  const moved = writeGeneratedDocumentation();
  for (const file of moved) process.stdout.write(`Regenerated ${file}\n`);

  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(specificationFile, `${JSON.stringify(documentationSpecification(), null, 2)}\n`);
  process.stdout.write(`Composed ${specificationFile}\n`);

  const result = spawnSync(
    process.execPath,
    [binary, 'build', '--spec', specificationFile, '--out', outputDirectory, '--base', '/'],
    { stdio: 'inherit' },
  );

  if (result.status === 0) {
    // Beside the `llms.txt` the product's build already wrote. See `siteLlmsFullText` for why
    // the full text is written here and not by the product: a static export has no live route
    // to answer it, and this site wants the whole reference reachable from one address. A
    // failure here fails the build, because a site that says it carries the file and does not
    // is the exact class of silent gap this repository exists to refuse.
    writeFileSync(join(outputDirectory, 'llms-full.txt'), siteLlmsFullText());
    process.stdout.write('Wrote llms-full.txt at the site root\n');
  }

  return result.status ?? 1;
}

process.exitCode = buildDocumentationSite();
