/**
 * Whether a built browser chunk can be loaded by a browser at all.
 *
 * THE DEFECT THIS EXISTS FOR SHIPPED, AND NOTHING SAW IT. `sha256Hex` in `@openref/core` reached
 * `@noble/hashes/sha2` by bare name, T028 called it for the PKCE challenge, and the bundler left
 * `import"@noble/hashes/sha2"` in the chunk the first paint loads. A browser has no import map, so
 * the specifier does not resolve, so the module never evaluates, so the entry never evaluates: the
 * page rendered from the server's markup and did nothing at all. The console was dead and so was
 * the command palette.
 *
 * EVERY CHECK RAN SOMEWHERE THE DEFECT DOES NOT EXIST. The artefact built. The size budgets weighed
 * it and were inside their limits. The CSP scan read it and found nothing to block. The module
 * graph walked it and accounted for every file. The unit and integration suites imported the same
 * source under Node, where a bare specifier resolves through `node_modules` and the code is
 * correct. It surfaced because a browser happened to run it in one session, which is not a check.
 *
 * SO THE QUESTION THIS ASKS IS THE ONE NONE OF THEM ASKED: does every specifier in a browser chunk
 * resolve without an import map. Relative and absolute paths do. A bare specifier does not, and
 * neither does a specifier this module cannot read, which is reported rather than skipped for the
 * reason the unaccounted set exists one level up: a scan that quietly reads nothing is the failure
 * mode that looks like a pass.
 *
 * A REGULAR EXPRESSION OVER MINIFIED OUTPUT, with the limits that carries. A specifier shaped
 * string sitting inside a string literal would be reported, and that is the direction to be wrong
 * in: a false alarm gets read, and a missed bare specifier is a dead page.
 */

/** How a specifier resolves in a browser with no import map. */
export type SpecifierKind =
  /** `./x` or `../x`, resolved against the importing module's url. */
  | 'relative'
  /** `/x`, resolved against the origin. */
  | 'absolute-path'
  /** `https://x/y`, resolved against nothing, and fetched from somebody else's server. */
  | 'external-url'
  /** `vue`, `@noble/hashes/sha2`. A browser needs an import map, and this project ships none. */
  | 'bare';

/** How a specifier was written. */
export type SpecifierForm = 'static' | 'dynamic';

/** One specifier found in a chunk. */
export interface ModuleSpecifier {
  readonly specifier: string;
  readonly kind: SpecifierKind;
  readonly form: SpecifierForm;
}

/** What one chunk names, and what it names in a way this module cannot read. */
export interface ChunkSpecifiers {
  readonly specifiers: readonly ModuleSpecifier[];
  /**
   * Excerpts of `import(` calls whose argument is not a literal string.
   *
   * A bundler does not emit one, so finding one means the question was not answered for that
   * edge, which is reported rather than passed over.
   */
  readonly unreadable: readonly string[];
}

/** Matches `import("./x")` and the template literal form with no substitution in it. */
const DYNAMIC = /\bimport\s*\(\s*(['"`])([^'"`]*)\1\s*\)/g;

/** Matches `from"./x"` and a bare `import"./x"`, in the minified form that has no whitespace. */
const STATIC = /(?:\bfrom|\bimport)\s*(['"`])([^'"`]*)\1/g;

/** Matches an `import(` whose argument does not begin with a quote. */
const DYNAMIC_UNREADABLE = /\bimport\s*\(\s*(?!['"`])/g;

/**
 * Classifies one specifier by how a browser would resolve it.
 *
 * @param specifier - The specifier as written in the module
 * @returns Which of the four kinds it is
 */
export function classifySpecifier(specifier: string): SpecifierKind {
  if (specifier.startsWith('./') || specifier.startsWith('../')) return 'relative';

  // The protocol relative form is tested before the absolute one, because it begins with the same
  // character and means the opposite thing: `//host/x` is another origin, not a path on this one.
  if (specifier.startsWith('//') || /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(specifier)) {
    return 'external-url';
  }

  if (specifier.startsWith('/')) return 'absolute-path';

  return 'bare';
}

/**
 * Reads every import specifier a module names.
 *
 * @param source - Contents of a built chunk
 * @returns Every specifier with its kind and form, plus the edges that could not be read
 */
export function specifiersIn(source: string): ChunkSpecifiers {
  const specifiers: ModuleSpecifier[] = [];

  for (const match of source.matchAll(DYNAMIC)) {
    specifiers.push({
      specifier: match[2] ?? '',
      kind: classifySpecifier(match[2] ?? ''),
      form: 'dynamic',
    });
  }

  // The dynamic form is blanked before the static scan, because `import("./x")` also matches the
  // bare `import "./x"` shape and would otherwise be counted on both sides at once. What replaces
  // it keeps no `import(` in it: a placeholder that did would be read back as a call whose argument
  // this module cannot see, and every deferred chunk would be reported as unreadable.
  const withoutDynamic = source.replace(DYNAMIC, '0');

  for (const match of withoutDynamic.matchAll(STATIC)) {
    specifiers.push({
      specifier: match[2] ?? '',
      kind: classifySpecifier(match[2] ?? ''),
      form: 'static',
    });
  }

  const unreadable = [...withoutDynamic.matchAll(DYNAMIC_UNREADABLE)].map((match) =>
    withoutDynamic.slice(match.index, match.index + 60),
  );

  return { specifiers, unreadable };
}
