import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { BROWSER_MODULE_EXTENSIONS, SHIPPED_CLIENT_BUNDLES } from '../config.js';
import { specifiersIn, type SpecifierKind } from '../lib/browser-specifiers.js';
import { browserScanRoots } from '../lib/package-dirs.js';
import { collectFiles } from '../lib/walk.js';
import type { Gate, GateFinding, GateResult } from '../types.js';

/**
 * Whether every import specifier in a built browser chunk resolves without an import map.
 *
 * THE CLASS OF DEFECT: AN ARTEFACT THAT BUILDS, PASSES EVERY SIZE AND CONTENT CHECK, AND CANNOT
 * EXECUTE IN THE ENVIRONMENT IT SHIPS TO. `sha256Hex` pulled `@noble/hashes/sha2` into the chunk
 * the first paint loads, by bare name. Nothing was red: the build produced the file, the budgets
 * weighed it, the CSP scan read it, the module graph accounted for it, and every suite that
 * imported the same code ran under Node, where the specifier resolves. A browser has no import
 * map, so the module did not evaluate and the entry did not either. The page rendered and did
 * nothing.
 *
 * The general form of the class is that every check ran somewhere the defect does not exist, and
 * this gate is the one check that runs where it does: over the built chunk, asking the browser's
 * question about it.
 *
 * IT COVERS THE DEFERRED CHUNKS FOR A REASON WORTH SAYING. A dead entry is visible in the first
 * second; a dead deferred chunk fails when a reader presses Send, on their machine, and the page
 * around it goes on looking correct. So the material is every file under the roots rather than the
 * initial closure, and a chunk no graph reaches is scanned anyway.
 *
 * FOUR THINGS ARE ERRORS AND EACH IS THE SAME OUTCOME. A bare specifier does not resolve. A remote
 * url resolves and fetches from somebody else's server, which SPEC 19 forbids outright. A relative
 * specifier naming a file that was not built is a 404 with the same consequence as the first. And
 * an `import(` this scan cannot read leaves the question unanswered for that edge, which is
 * reported rather than passed over.
 */

/** What a kind of specifier costs a reader, in the words the finding uses. */
const CONSEQUENCE: Record<Exclude<SpecifierKind, 'relative' | 'absolute-path'>, string> = {
  bare: 'a browser has no import map, so this module never evaluates and neither does anything that imports it',
  'external-url':
    'this resolves to a server that is not the one serving the page, and SPEC 19 promises a reference that makes no external request',
};

export const browserResolutionGate: Gate = {
  id: 'browser-resolution',
  title: 'Browser chunks resolve every specifier without an import map',

  run(context): Promise<GateResult> {
    const findings: GateFinding[] = [];
    const roots = browserScanRoots(context.repoRoot);
    const scanned: string[] = [];
    let specifierCount = 0;
    let failed = false;

    for (const root of roots) {
      for (const file of collectFiles(
        join(context.repoRoot, root),
        BROWSER_MODULE_EXTENSIONS,
        context.repoRoot,
      )) {
        scanned.push(file);
        const source = readFileSync(join(context.repoRoot, file), 'utf8');
        const found = specifiersIn(source);
        const reported = new Set<string>();

        for (const entry of found.specifiers) {
          specifierCount += 1;

          if (entry.kind === 'bare' || entry.kind === 'external-url') {
            if (reported.has(entry.specifier)) continue;
            reported.add(entry.specifier);
            failed = true;
            findings.push({
              level: 'error',
              message: `${file} imports ${JSON.stringify(entry.specifier)} (${entry.kind}, ${entry.form}): ${CONSEQUENCE[entry.kind]}`,
            });
            continue;
          }

          if (entry.kind !== 'relative') continue;

          const target = posix.normalize(posix.join(dirname(file), entry.specifier));
          if (existsSync(join(context.repoRoot, target))) continue;
          if (reported.has(entry.specifier)) continue;
          reported.add(entry.specifier);
          failed = true;
          findings.push({
            level: 'error',
            message: `${file} imports ${JSON.stringify(entry.specifier)}, and ${target} was not built: the specifier resolves to a url that answers 404, which stops this module evaluating`,
          });
        }

        for (const excerpt of found.unreadable) {
          failed = true;
          findings.push({
            level: 'error',
            message: `${file} has a dynamic import this scan cannot read, so nothing here says whether it resolves: ${excerpt.trim()}`,
          });
        }
      }
    }

    // THE CHECK IN THE OTHER DIRECTION, and it is the one that keeps the roots from going stale.
    // The roots are a convention, `dist/browser` under each package, so a bundle that started
    // writing its entry somewhere else would be scanned by nothing while this gate went on
    // printing a file count and passing. What ships is declared, so the declaration is asked
    // whether the scan reached it.
    const scannedSet = new Set(scanned);
    for (const bundle of SHIPPED_CLIENT_BUNDLES) {
      if (scannedSet.has(bundle.file)) continue;
      if (scanned.length === 0) continue;

      failed = true;
      findings.push({
        level: 'error',
        message:
          `${bundle.label} ships ${bundle.file} and this scan did not read it. The roots are ` +
          `${roots.join(', ')}, so either the entry moved out of them or it was not built, and ` +
          `in both cases the bundle a reader loads is checked by nothing here`,
      });
    }

    if (scanned.length === 0) {
      findings.push({
        level: 'info',
        message: `SKIP no built browser modules under ${roots.join(', ')}; run pnpm build first`,
      });

      return Promise.resolve({
        id: browserResolutionGate.id,
        title: browserResolutionGate.title,
        status: 'skip',
        skipReason: 'artifact-absent',
        findings,
      });
    }

    if (!failed) {
      findings.push({
        level: 'info',
        message: `${String(specifierCount)} specifier(s) in ${String(scanned.length)} browser module(s) resolve with no import map`,
      });
    }

    return Promise.resolve({
      id: browserResolutionGate.id,
      title: browserResolutionGate.title,
      status: failed ? 'fail' : 'pass',
      findings,
    });
  },
};
