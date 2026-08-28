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
 * IT WAS THREE REGULAR EXPRESSIONS UNTIL T042, AND THE SECOND CLASS WENT STRAIGHT THROUGH THEM.
 * T035 measured it: `import("./chunk-"+h)` matches neither the dynamic pattern, whose group cannot
 * hold a concatenation, nor the static one, and the `unreadable` branch that existed to catch
 * exactly that was defeated by its own lookahead, which sees the opening quote of the first operand
 * and declines. The gate reported zero specifiers for a chunk graph addressed that way, which is
 * the same shape as the defect it was written for. `new URL(spec, import.meta.url)` and
 * `import.meta.resolve(spec)` were two more forms it had never heard of.
 *
 * THE FIX IS A PARSER AND NOT A FOURTH PATTERN, in the amendment's own words. A regular expression
 * over minified text cannot tell a specifier from a string that looks like one, cannot see where an
 * argument list ends, and answers "no match" for every form nobody thought to write down, which is
 * indistinguishable here from "nothing to report". `acorn` produces the module's actual syntax
 * tree, so an import edge is found by being an import edge: a specifier that is not a single string
 * literal is reported as unreadable whatever expression leads it, and a chunk that will not parse
 * is reported rather than counted as clean.
 */

import { parse, type Node, type Program } from 'acorn';

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

/**
 * How a specifier was written.
 *
 * The last two arrived with the parser. Both address a module without an `import` statement in
 * front of them, both were invisible to the patterns this file used to be, and both are how a
 * bundler that emits asset urls names a chunk.
 */
export type SpecifierForm =
  /** `import x from "./a"`, `export {x} from "./a"`, `import "./a"`. */
  | 'static'
  /** `import("./a")`. */
  | 'dynamic'
  /** `import.meta.resolve("./a")`. */
  | 'meta-resolve'
  /** `new URL("./a", import.meta.url)`. */
  | 'module-url';

/** One specifier found in a chunk. */
export interface ModuleSpecifier {
  readonly specifier: string;
  readonly kind: SpecifierKind;
  readonly form: SpecifierForm;
}

/** Why one edge of a chunk went unread. */
export type UnreadableReason =
  /** The module addresses something and the address is computed rather than written. */
  | 'computed-specifier'
  /** The file is not a module this parser can read, so none of its edges were seen. */
  | 'unparsed';

/** One edge whose specifier this module could not read. */
export interface UnreadableEdge {
  readonly reason: UnreadableReason;
  /** The form that led it, absent when the whole file failed to parse. */
  readonly form?: SpecifierForm;
  /** The source as written, trimmed to something a finding can print. */
  readonly excerpt: string;
}

/** What one chunk names, and what it names in a way this module cannot read. */
export interface ChunkSpecifiers {
  readonly specifiers: readonly ModuleSpecifier[];
  /**
   * Edges whose specifier is not a single string literal, plus a file that would not parse.
   *
   * A bundler does not emit a computed one, so finding one means the question was not answered
   * for that edge, which is reported rather than passed over. An unparsed file is the same
   * statement about every edge at once.
   */
  readonly unreadable: readonly UnreadableEdge[];
}

/** How much of an expression a finding prints. */
const EXCERPT_LIMIT = 120;

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

/** The shape every acorn node has that this walk needs. */
interface SyntaxNode extends Node {
  readonly type: string;
}

/**
 * Whether a value is a syntax node, which is what makes the walk generic.
 *
 * A WALK OVER EVERY KEY RATHER THAN A VISITOR PER NODE TYPE. A visitor list is a second thing to
 * maintain against a grammar that grows, and a node type nobody added to it is a subtree nobody
 * looked at, which is this file's own history restated one level up.
 *
 * @param value - Anything reached while descending a node
 * @returns True when it is a node with a type and a source range
 */
function isSyntaxNode(value: unknown): value is SyntaxNode {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { type?: unknown; start?: unknown; end?: unknown };
  return (
    typeof candidate.type === 'string' &&
    typeof candidate.start === 'number' &&
    typeof candidate.end === 'number'
  );
}

/**
 * Calls back for every node of a tree, in document order.
 *
 * @param node - Where to start
 * @param visit - Called once per node
 */
function walk(node: SyntaxNode, visit: (found: SyntaxNode) => void): void {
  visit(node);

  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isSyntaxNode(item)) walk(item, visit);
      }
      continue;
    }

    if (isSyntaxNode(value)) walk(value, visit);
  }
}

/** A node that carries a literal string value, which is what a readable specifier is. */
function stringValueOf(node: unknown): string | undefined {
  if (!isSyntaxNode(node)) return undefined;

  if (node.type === 'Literal') {
    const value = (node as unknown as { value?: unknown }).value;
    return typeof value === 'string' ? value : undefined;
  }

  // A template with no substitution is a string a bundler does write, and it resolves exactly as
  // the quoted form does. One with a substitution is the computed case and is not read here.
  if (node.type === 'TemplateLiteral') {
    const expressions = (node as unknown as { expressions?: unknown }).expressions;
    const quasis = (node as unknown as { quasis?: unknown }).quasis;
    if (!Array.isArray(expressions) || expressions.length > 0) return undefined;
    if (!Array.isArray(quasis) || quasis.length !== 1) return undefined;

    const cooked = (quasis[0] as { value?: { cooked?: unknown } }).value?.cooked;
    return typeof cooked === 'string' ? cooked : undefined;
  }

  return undefined;
}

/** Whether a node is the `import.meta` meta property. */
function isImportMeta(node: unknown): boolean {
  if (!isSyntaxNode(node) || node.type !== 'MetaProperty') return false;
  const meta = node as unknown as { meta?: { name?: unknown }; property?: { name?: unknown } };
  return meta.meta?.name === 'import' && meta.property?.name === 'meta';
}

/** Whether a node is a member expression `<object>.<name>` with a plain name. */
function isMemberNamed(node: unknown, name: string): boolean {
  if (!isSyntaxNode(node) || node.type !== 'MemberExpression') return false;
  const member = node as unknown as {
    computed?: unknown;
    object?: unknown;
    property?: { name?: unknown };
  };
  if (member.computed === true) return false;
  return isImportMeta(member.object) && member.property?.name === name;
}

/** Whether a node is the identifier `URL`. */
function isUrlCallee(node: unknown): boolean {
  if (!isSyntaxNode(node) || node.type !== 'Identifier') return false;
  return (node as unknown as { name?: unknown }).name === 'URL';
}

/**
 * Reads every import specifier a module names.
 *
 * FIVE FORMS ADDRESS A MODULE AND ALL FIVE ARE READ HERE. The three statement forms, the dynamic
 * call, `import.meta.resolve`, and `new URL(spec, import.meta.url)`, which is what a bundler emits
 * for an asset a chunk fetches by url rather than imports. What is not one of these is not an
 * import edge, and a string that merely looks like a specifier is left alone, which is the whole
 * gain over reading the text: `"./chunk-a.js"` inside a message is a message.
 *
 * @param source - Contents of a built chunk
 * @returns Every specifier with its kind and form, plus the edges that could not be read
 */
export function specifiersIn(source: string): ChunkSpecifiers {
  const specifiers: ModuleSpecifier[] = [];
  const unreadable: UnreadableEdge[] = [];

  const excerpt = (node: SyntaxNode): string =>
    source.slice(node.start, Math.min(node.end, node.start + EXCERPT_LIMIT)).trim();

  const record = (node: SyntaxNode, argument: unknown, form: SpecifierForm): void => {
    const value = stringValueOf(argument);

    if (value === undefined) {
      unreadable.push({ reason: 'computed-specifier', form, excerpt: excerpt(node) });
      return;
    }

    specifiers.push({ specifier: value, kind: classifySpecifier(value), form });
  };

  let program: Program;
  try {
    program = parse(source, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      allowHashBang: true,
      allowAwaitOutsideFunction: true,
    });
  } catch (error) {
    // A FILE THAT WILL NOT PARSE IS NOT A FILE WITH NOTHING IN IT. Returning an empty list here
    // would be the exact reading the whole gate exists to refuse, so the failure is the finding.
    return {
      specifiers: [],
      unreadable: [
        {
          reason: 'unparsed',
          excerpt: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }

  walk(program, (node) => {
    if (
      node.type === 'ImportDeclaration' ||
      node.type === 'ExportNamedDeclaration' ||
      node.type === 'ExportAllDeclaration'
    ) {
      const rawSource = (node as unknown as { source?: unknown }).source;
      // `export {x}` with no `from` carries no source and addresses nothing.
      if (rawSource === null || rawSource === undefined) return;
      record(node, rawSource, 'static');
      return;
    }

    if (node.type === 'ImportExpression') {
      record(node, (node as unknown as { source?: unknown }).source, 'dynamic');
      return;
    }

    if (node.type === 'CallExpression') {
      const call = node as unknown as { callee?: unknown; arguments?: unknown };
      if (!isMemberNamed(call.callee, 'resolve')) return;
      const args = Array.isArray(call.arguments) ? call.arguments : [];
      record(node, args[0], 'meta-resolve');
      return;
    }

    if (node.type === 'NewExpression') {
      const created = node as unknown as { callee?: unknown; arguments?: unknown };
      if (!isUrlCallee(created.callee)) return;
      const args = Array.isArray(created.arguments) ? created.arguments : [];
      // `new URL(x)` with no base is an address of its own and not a module edge; the second
      // argument is what makes it one, and `import.meta.url` is the only base that does.
      if (args.length < 2 || !isMemberNamed(args[1], 'url')) return;
      record(node, args[0], 'module-url');
    }
  });

  return { specifiers, unreadable };
}
