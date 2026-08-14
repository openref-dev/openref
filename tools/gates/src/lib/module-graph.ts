/**
 * Splitting a built browser bundle into what a first paint loads and what it defers.
 *
 * WHY A BUDGET CANNOT BE A DIRECTORY ANY MORE. Until T011-R the browser bundle was one file, so
 * "every `.js` under `dist/browser`" and "what the page loads" were the same set and the budget
 * could be a walk of a directory. A code split makes them different sets: the directory now holds
 * eleven files, four of which no reader loads on first paint. Summing the directory reported
 * 45.8 KB gzip for a page that costs 37.8, which is a budget measuring a quantity nobody pays and
 * is the same defect class SPEC 0 records for `theme-css`, one level up: the number was right
 * about something, and that something was not what the row promised.
 *
 * SO THE PARTITION IS COMPUTED FROM THE GRAPH AND NOT DECLARED IN A LIST. A hand written list of
 * which chunks are deferred is a second copy of a fact the bundler already decided, and it would
 * go stale the first time a chunk was renamed by its content hash, which is every time its
 * content changes.
 *
 * THE THIRD SET IS THE ONE THAT MAKES THE OTHER TWO TRUSTWORTHY. Anything under the roots that
 * neither walk reached is reported as unaccounted, and a budget with an unaccounted file fails.
 * Without it, a specifier syntax this parser does not understand would silently shrink the
 * initial closure to the entry alone and report the smallest bundle this project has ever built.
 */

import { readFileSync } from 'node:fs';
import { basename, dirname, join, posix, relative } from 'node:path';

/** The two sides of a split bundle, plus whatever answers to neither. */
export interface ModuleGraphPartition {
  /** The entry and everything reachable from it through static imports only. */
  readonly initial: readonly string[];
  /** Everything reachable only by passing through at least one dynamic import. */
  readonly deferred: readonly string[];
  /** Files under the roots that neither walk reached. */
  readonly unaccounted: readonly string[];
}

/**
 * Every relative specifier a module names, split by how it names them.
 *
 * A REGULAR EXPRESSION OVER MINIFIED OUTPUT, and the limits of that are why the unaccounted set
 * exists. What is matched is an ECMAScript module's own syntax as an ES module bundler emits it:
 * `from "./x"`, a bare `import "./x"`, and `import("./x")`. A bundler that started emitting
 * something else would leave files nobody reached, and that is a failure rather than a smaller
 * bundle.
 */
export function specifiersOf(source: string): { static: string[]; dynamic: string[] } {
  const dynamic = [...source.matchAll(/\bimport\(\s*['"](\.[^'"]*)['"]\s*\)/g)].map(
    (match) => match[1] ?? '',
  );

  // The dynamic form is removed before the static scan, because `import("./x")` also matches the
  // bare `import "./x"` shape and would otherwise be counted on both sides at once.
  const withoutDynamic = source.replace(/\bimport\(\s*['"](\.[^'"]*)['"]\s*\)/g, 'import(0)');
  const staticSpecifiers = [
    ...withoutDynamic.matchAll(/(?:\bfrom|\bimport)\s*['"](\.[^'"]*)['"]/g),
  ].map((match) => match[1] ?? '');

  return { static: [...new Set(staticSpecifiers)], dynamic: [...new Set(dynamic)] };
}

/** Reads a module, or returns null when the specifier points at nothing. */
function readModule(absolutePath: string): string | null {
  try {
    return readFileSync(absolutePath, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Walks a bundle from its entry and reports the two sides and the remainder.
 *
 * @param repoRoot - Absolute repository root
 * @param entry - Repository relative path of the entry module
 * @param candidates - Repository relative paths of every file the roots hold, so a file the
 *   graph does not reach can be named rather than assumed absent
 * @returns The initial closure, the deferred set, and whatever neither reached
 * @throws Error when the entry itself cannot be read, because an unreadable entry would
 *   otherwise partition into two empty sets and read as a bundle that costs nothing
 */
export function partitionModuleGraph(
  repoRoot: string,
  entry: string,
  candidates: readonly string[],
): ModuleGraphPartition {
  const entrySource = readModule(join(repoRoot, entry));
  if (entrySource === null) {
    throw new Error(`the bundle entry ${entry} could not be read`);
  }

  const dynamicRoots: string[] = [];

  /**
   * Follows static edges only, collecting dynamic edges as it goes.
   *
   * @param start - Repository relative path to walk from
   * @param stop - Modules already accounted for on an earlier walk
   * @returns Everything reachable from `start` without crossing a dynamic import
   */
  const staticClosure = (start: string, stop: ReadonlySet<string>): Set<string> => {
    const reached = new Set<string>();
    const queue = [start];

    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined || reached.has(current) || stop.has(current)) continue;

      const source = readModule(join(repoRoot, current));
      if (source === null) continue;

      reached.add(current);
      const specifiers = specifiersOf(source);
      const directory = dirname(current);

      for (const specifier of specifiers.static) {
        queue.push(posix.normalize(posix.join(directory, specifier)));
      }

      for (const specifier of specifiers.dynamic) {
        dynamicRoots.push(posix.normalize(posix.join(directory, specifier)));
      }
    }

    return reached;
  };

  const initial = staticClosure(entry, new Set());

  // THE DYNAMIC ROOTS ARE COLLECTED WHILE WALKING, INCLUDING FROM DEFERRED CHUNKS, so a feature
  // that defers something of its own is on the deferred side rather than unaccounted for.
  // THE LIST GROWS WHILE IT IS BEING WALKED, which is deliberate and is why it is a list rather
  // than a snapshot: an array iterator re-reads the length on every step, so a dynamic import
  // found inside a deferred chunk is visited by this same loop.
  const deferred = new Set<string>();
  for (const root of dynamicRoots) {
    if (initial.has(root) || deferred.has(root)) continue;
    for (const module of staticClosure(root, initial)) deferred.add(module);
  }

  const unaccounted = candidates.filter((file) => !initial.has(file) && !deferred.has(file));

  return {
    initial: [...initial].sort(),
    deferred: [...deferred].sort(),
    unaccounted: [...unaccounted].sort(),
  };
}

/**
 * One gesture the deferred half is divided by, and the chunks its fetch starts from.
 *
 * WHY THIS ONE THING CANNOT BE DERIVED FROM THE GRAPH, said here because everything else in this
 * file is. The graph knows that four chunks hang off dynamic imports of the entry; it does not
 * know that three of those imports are made by a component the reader opened and the fourth is
 * made from inside the console's own loader. `loadRunner` is handed to the renderer as a function,
 * so the `import('@openref/runner')` is written in the entry file and the runner is a dynamic root
 * of the entry, while the only thing that ever calls it is the try-it console arriving. Which
 * gesture pays for a chunk is a fact about the source, and a declaration is the only honest form
 * for it.
 *
 * SO IT IS CHECKED IN BOTH DIRECTIONS, which is what keeps a declaration from going stale in
 * silence. A named root that matches no deferred chunk fails, because a budget over nothing is
 * worse than no budget. A root that matches more than one fails, because then it is not clear
 * what was weighed. And a deferred chunk no gesture claims fails, for the reason the unaccounted
 * set exists one level up: a chunk nobody pays for is either dead output or a gesture nobody
 * named, and both read as a smaller bundle.
 */
export interface DeferredGesture {
  /** Short id, used in the budget id. */
  readonly id: string;
  /**
   * Chunk names without the content hash, as the bundler derives them from the module it split.
   *
   * `TryItPanel-UOGJVNJF.js` is matched by `TryItPanel`. The hash changes with every change to
   * the content, which is exactly why the name is written without it.
   */
  readonly roots: readonly string[];
}

/** What one gesture downloads, and everything wrong with how it was declared. */
export interface GestureSplit {
  /** Deferred files this gesture's roots reach, sorted. */
  readonly files: readonly string[];
  /** Declared roots that matched no deferred chunk. */
  readonly missingRoots: readonly string[];
  /** Declared roots that matched more than one, with what they matched. */
  readonly ambiguousRoots: readonly {
    readonly root: string;
    readonly matches: readonly string[];
  }[];
}

/** The deferred half divided by gesture, plus whatever no gesture claimed. */
export interface GesturePartition {
  readonly byGesture: ReadonlyMap<string, GestureSplit>;
  /** Deferred files reached by no declared gesture. */
  readonly unclaimed: readonly string[];
}

/**
 * Whether a deferred chunk is the one a declared root names.
 *
 * @param file - Repository relative path of a deferred chunk
 * @param root - Chunk name without the content hash
 * @returns True when the file is that chunk, hashed or not
 */
function isRoot(file: string, root: string): boolean {
  const name = basename(file);

  return name === `${root}.js` || (name.startsWith(`${root}-`) && name.endsWith('.js'));
}

/**
 * Divides the deferred side of a bundle by the gesture that downloads it.
 *
 * A CHUNK TWO GESTURES SHARE IS COUNTED IN BOTH, and that is the measurement rather than double
 * counting. Each budget answers what one gesture costs a reader who has made no other, which is
 * the only figure that can be read as "pressing Send now costs this much"; summing the three
 * would give a quantity nobody pays, which is the defect the whole partition exists about.
 *
 * @param repoRoot - Absolute repository root
 * @param partition - The two sides of the bundle, already walked
 * @param gestures - The declared gestures
 * @returns One split per gesture, in declaration order, and the deferred files none of them reach
 */
export function partitionByGesture(
  repoRoot: string,
  partition: ModuleGraphPartition,
  gestures: readonly DeferredGesture[],
): GesturePartition {
  const deferred = new Set(partition.deferred);
  const byGesture = new Map<string, GestureSplit>();
  const claimed = new Set<string>();

  for (const gesture of gestures) {
    const missingRoots: string[] = [];
    const ambiguousRoots: { root: string; matches: string[] }[] = [];
    const reached = new Set<string>();
    const queue: string[] = [];

    for (const root of gesture.roots) {
      const matches = partition.deferred.filter((file) => isRoot(file, root));

      if (matches.length === 0) {
        missingRoots.push(root);
        continue;
      }

      if (matches.length > 1) {
        ambiguousRoots.push({ root, matches });
        continue;
      }

      queue.push(matches[0] ?? '');
    }

    // Static edges only, and only inside the deferred set: a chunk the first paint already
    // compiled is not downloaded again by a reader who presses Send.
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined || reached.has(current) || !deferred.has(current)) continue;

      reached.add(current);
      claimed.add(current);

      const source = readModule(join(repoRoot, current));
      if (source === null) continue;

      const directory = dirname(current);
      for (const specifier of specifiersOf(source).static) {
        queue.push(posix.normalize(posix.join(directory, specifier)));
      }
    }

    byGesture.set(gesture.id, {
      files: [...reached].sort(),
      missingRoots,
      ambiguousRoots,
    });
  }

  return {
    byGesture,
    unclaimed: partition.deferred.filter((file) => !claimed.has(file)),
  };
}

/**
 * The file name of a module, for a message that names a chunk rather than a path.
 *
 * @param file - Repository relative path
 * @returns The base name
 */
export function chunkName(file: string): string {
  return basename(file);
}

/**
 * Turns an absolute path into the repository relative form the rest of the gate uses.
 *
 * @param repoRoot - Absolute repository root
 * @param absolutePath - Path inside it
 * @returns The relative path with forward slashes
 */
export function repoRelative(repoRoot: string, absolutePath: string): string {
  return relative(repoRoot, absolutePath).split('\\').join('/');
}
