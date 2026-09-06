import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readPackageDirs } from './package-dirs.js';

/**
 * The voice of SPEC 7.1, read off every ecosystem collector's own source.
 *
 * WHY IT IS A GATE AND NOT A TEST, in the words `reader-pages.gate.ts` uses for the same shape. The
 * sweep in `packages/nest/test/unit/discovery-voice.spec.ts` holds that package's own collectors to
 * this rule and named its own hole in its header: the ecosystem collectors live in their own
 * packages and cannot be swept from there without a test in one package asserting about another's
 * source, so a fifth ecosystem package could ship in the old voice and nothing would say so. That
 * sentence was written on the day the fourth one landed. This is where it stops being true.
 *
 * THE SET IS READ FROM THE DISK AND NEVER NAMED, which is the whole point and the reason a list of
 * four paths in the nest spec could not have closed this. {@link collectorPackages} asks
 * `readPackageDirs` for what is under `packages/` and keeps what the naming convention of SPEC 4
 * marks as a collector, so a package added to the repository is swept from the moment its directory
 * exists. That is the same derivation `cspScanRoots` uses, for the same defect: F23 was a hand
 * written package list nobody compared to the disk.
 *
 * THE WALK IS THE NEST SWEEP'S WALK, DELIBERATELY, AND THE TWO ARE RECONCILED RATHER THAN SHARED.
 * A `reason` holds commas, braces and apostrophes, so a pattern that stops at the first one of them
 * reads half a sentence and passes a bound it never measured; the nest spec learned that and wrote
 * a character walk, and a second instrument with a weaker reader would report a clean sweep over
 * text it never finished reading. What is not shared is the bound: it lives in `config.ts` here and
 * as `REASON_LIMIT` there, and `collector-voice.spec.ts` reads the spec file and fails when the two
 * numbers stop agreeing, because a gate that measured 140 while the package next door measured 200
 * would be two rules wearing one name.
 */

/** Where a `${...}` is counted as a value of ordinary length rather than as its own source text. */
const PLACEHOLDER = 'X'.repeat(20);

/** How far past a reason an action may sit and still be the next member of the same literal. */
const ACTION_WINDOW = 800;

/** The prefix SPEC 4's naming convention gives every ecosystem collector package. */
export const COLLECTOR_PREFIX = 'collector-';

/** One `problems.push({ ... })` found in a collector package's source. */
export interface CollectorReason {
  /** Repository relative path of the file it was written in. */
  readonly file: string;
  /** The directory under `packages/` it belongs to. */
  readonly packageDir: string;
  /** The text the member evaluates to, with every interpolation counted as a value. */
  readonly reason: string;
  /** Whether an `action` sits beside it rather than inside it. */
  readonly hasAction: boolean;
}

/** What one collector package's source contributed. */
export interface CollectorScan {
  readonly packageDir: string;
  /** How many `problems.push(` calls its source makes, which is what the walk has to account for. */
  readonly pushes: number;
  readonly reasons: readonly CollectorReason[];
}

/**
 * The ecosystem collector packages of SPEC 4, as the disk holds them.
 *
 * @param repoRoot - Absolute repository root
 * @returns Directory names under `packages/`, sorted
 */
export function collectorPackages(repoRoot: string): readonly string[] {
  return readPackageDirs(repoRoot).filter((dir) => dir.startsWith(COLLECTOR_PREFIX));
}

/** Every `.ts` file under one path, which may itself be a file or may not exist. */
function sourcesUnder(path: string): readonly string[] {
  let entries;
  try {
    entries = statSync(path).isDirectory() ? readdirSync(path, { withFileTypes: true }) : undefined;
  } catch {
    return [];
  }
  if (entries === undefined) return path.endsWith('.ts') ? [path] : [];

  const found: string[] = [];
  for (const entry of entries) found.push(...sourcesUnder(join(path, entry.name)));

  return found;
}

/**
 * Reads the value of one object member as the text it produces, following `+` concatenation.
 *
 * A WALK AND NOT A PATTERN, for the reason the nest sweep gives about the same problem. It is that
 * function, carried here rather than imported, because a gate cannot import a spec file and a spec
 * file must not import a gate's build output.
 *
 * @param source - The whole file
 * @param from - Index just after the member's colon
 * @returns The text the member evaluates to, with every interpolation counted as a value
 */
export function valueAt(source: string, from: number): string {
  let at = from;
  let text = '';
  let depth = 0;

  while (at < source.length) {
    const char = source[at];

    if (char === '{' || char === '[' || char === '(') depth += 1;
    if (char === '}' || char === ']' || char === ')') {
      if (depth === 0) break;
      depth -= 1;
    }
    if (char === ',' && depth === 0) break;

    if (char === "'" || char === '"' || char === '`') {
      const quote = char;
      at += 1;
      while (at < source.length && source[at] !== quote) {
        if (source[at] === '\\') {
          at += 2;
          continue;
        }
        if (quote === '`' && source[at] === '$' && source[at + 1] === '{') {
          let inner = 1;
          at += 2;
          while (at < source.length && inner > 0) {
            if (source[at] === '{') inner += 1;
            if (source[at] === '}') inner -= 1;
            at += 1;
          }
          text += PLACEHOLDER;
          continue;
        }
        text += source[at] ?? '';
        at += 1;
      }
    }

    at += 1;
  }

  return text;
}

/**
 * The text of the object literal a member sits in, back to the brace that opens it.
 *
 * THE LITERAL AND NOT A WINDOW OF CHARACTERS, for the reason the nest sweep records: a fixed look
 * back reads whatever JSDoc happens to be above and can name a `subject` that is a parameter rather
 * than a member.
 *
 * @param source - The whole file
 * @param at - Index of the member name
 * @returns The literal's text from its opening brace up to that index
 */
export function literalAround(source: string, at: number): string {
  let depth = 0;

  for (let back = at - 1; back >= 0; back -= 1) {
    const char = source[back];
    if (char === '}' || char === ')' || char === ']') depth += 1;
    else if (char === '{' || char === '(' || char === '[') {
      if (depth === 0) return source.slice(back, at);
      depth -= 1;
    }
  }

  return '';
}

/**
 * Reads one collector package's source for the reasons it writes.
 *
 * @param repoRoot - Absolute repository root
 * @param packageDir - Directory name under `packages/`
 * @returns What its source holds and what the walk read out of it
 */
export function scanCollector(repoRoot: string, packageDir: string): CollectorScan {
  const root = join(repoRoot, 'packages', packageDir);
  const reasons: CollectorReason[] = [];
  let pushes = 0;

  for (const file of sourcesUnder(join(root, 'src'))) {
    const source = readFileSync(file, 'utf8');
    pushes += [...source.matchAll(/problems\.push\(/g)].length;

    for (const match of source.matchAll(/\breason:/g)) {
      const from = match.index + match[0].length;

      // A `reason` IS ONE OF THESE ONLY WHEN A `subject` IS BESIDE IT, which is the shape of
      // `IRDiscoveryProblem`. An interface declaration matches the same look back and falls out
      // below, because `readonly reason: string` evaluates to no text at all.
      if (!/\bsubject\s*[,:?]/.test(literalAround(source, match.index))) continue;

      const reason = valueAt(source, from);
      if (reason === '') continue;

      reasons.push({
        file: file.slice(repoRoot.length + 1),
        packageDir,
        reason,
        hasAction: /\n\s{2,}action:/.test(source.slice(from, from + ACTION_WINDOW)),
      });
    }
  }

  return { packageDir, pushes, reasons };
}

/**
 * Reads every ecosystem collector package.
 *
 * @param repoRoot - Absolute repository root
 * @returns One scan per collector package, in directory order
 */
export function scanCollectors(repoRoot: string): readonly CollectorScan[] {
  return collectorPackages(repoRoot).map((dir) => scanCollector(repoRoot, dir));
}
