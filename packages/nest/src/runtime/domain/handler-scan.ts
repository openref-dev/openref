/**
 * The handler scan of SPEC 6.2.1: which declared parameters was the handler seen to read.
 *
 * A NESTJS HANDLER RECEIVES THE REQUEST ONLY THROUGH ITS BINDINGS, which is what makes this scan
 * possible at all: on a default scoped controller with no `@Req`, `@Res` and no custom parameter
 * decorator, the route argument metadata is the complete list of access paths. A binding by name,
 * `@Query('sort')`, is a read of that name. A whole object binding, `@Query() q`, is read by
 * scanning the emitted function source for property access on that argument. Everything else is
 * a reason to refuse.
 *
 * EVERY ERROR THE SCAN CAN MAKE IS MADE IN THE SAFE DIRECTION, and that is a design property
 * rather than luck. The source is scanned raw, without stripping strings or comments, so a name
 * inside a string can be over-counted as a read, and a strange use can be over-counted as
 * opacity; both suppress findings. Under-counting an occurrence of an identifier is what a word
 * boundary match cannot do. `not-seen-read` is therefore claimed only when every access path of
 * a location was accounted for and the name is genuinely not among the reads, which is the
 * discipline SPEC 6.2.1 requires the fact to carry.
 *
 * BLINDNESS IS A RESULT, NOT A FACT. A handler the scan cannot account for, `@Req`, `@Res`, a
 * custom decorator, a request scoped controller, an unparseable or mismatched source, produces
 * `blind` with the reason, and the collector turns that into a `doctor` problem and no fact.
 */

import type { IRParameterLocation, IRParameterRead } from '@openref/core';
import {
  NEST_CUSTOM_ROUTE_ARGS_MARKER,
  NEST_DEFAULT_SCOPE,
  NEST_ROUTE_ARGS_METADATA,
  NEST_ROUTE_PARAMTYPES,
  NEST_SCOPE_OPTIONS_METADATA,
  type HandlerLike,
  type MetadataReflect,
} from '../../shared/types/nest-surface';

/** One declared parameter, as the node spells it. */
export interface DeclaredParameter {
  readonly in: IRParameterLocation;
  readonly name: string;
}

/** What the scan concluded, or why it could not conclude anything. */
export type HandlerScanResult =
  | { readonly kind: 'scanned'; readonly parameters: readonly IRParameterRead[] }
  | { readonly kind: 'blind'; readonly reason: string; readonly detail: string };

/** The three parameter locations a NestJS binding can read, by paramtype number. */
const LOCATION_TYPES: readonly (readonly [IRParameterLocation, number])[] = [
  ['query', NEST_ROUTE_PARAMTYPES.query],
  ['path', NEST_ROUTE_PARAMTYPES.param],
  ['header', NEST_ROUTE_PARAMTYPES.headers],
];

/** Paramtypes that neither read a declared parameter nor open the whole request. */
const HARMLESS_TYPES: ReadonlySet<number> = new Set([
  NEST_ROUTE_PARAMTYPES.next,
  NEST_ROUTE_PARAMTYPES.body,
  NEST_ROUTE_PARAMTYPES.session,
]);

/** What one location's bindings added up to. */
interface LocationReads {
  /** Names seen read. Folded to lower case for headers by the caller. */
  readonly reads: Set<string>;
  /** True when a whole object binding could not be followed, so absence proves nothing. */
  opaque: boolean;
}

/**
 * Scans one handler against the parameters the document declares on its operation.
 *
 * @param reflect - The metadata API, from `metadataReflect()`
 * @param controller - The controller class the route was registered as
 * @param handlerName - The method name, as the prototype holds it
 * @param handler - The handler, whose emitted source is the scan's material
 * @param declared - The operation's parameters, in document order
 * @returns The verdicts, or the reason the handler cannot be accounted for
 */
export function scanHandlerReads(
  reflect: MetadataReflect,
  controller: object,
  handlerName: string,
  handler: HandlerLike,
  declared: readonly DeclaredParameter[],
): HandlerScanResult {
  const scope = controllerScope(reflect, controller);
  if (scope !== NEST_DEFAULT_SCOPE) {
    return {
      kind: 'blind',
      reason:
        'the controller is request scoped, so which parameters the handler reads cannot be seen',
      detail:
        'A request or transient scoped controller may inject REQUEST and read any parameter out ' +
        'of a field, which is an access path outside the handler body. Reporting the bindings ' +
        'that are visible would report them as the complete set.',
    };
  }

  const bindings = bindingsOf(reflect, controller, handlerName);
  if (bindings.kind === 'blind') return bindings;

  // THE SOURCE IS PARSED ONLY WHEN A WHOLE OBJECT BINDING NEEDS IT. A handler whose every
  // binding is by name is fully accounted for by metadata alone, and parsing nothing keeps the
  // scan off the source of the ordinary case.
  const wholeObject = bindings.entries.filter((entry) => entry.data === undefined);
  const source = wholeObject.length === 0 ? undefined : parseSource(handler);
  if (source?.kind === 'blind') return source;

  const byLocation = new Map<IRParameterLocation, LocationReads>(
    LOCATION_TYPES.map(([location]) => [location, { reads: new Set<string>(), opaque: false }]),
  );

  for (const entry of bindings.entries) {
    const location = LOCATION_TYPES.find(([, type]) => type === entry.type)?.[0];
    if (location === undefined) continue;

    const reads = byLocation.get(location);
    if (reads === undefined) continue;

    if (entry.data !== undefined) {
      reads.reads.add(location === 'header' ? entry.data.toLowerCase() : entry.data);
      continue;
    }

    // A whole object binding: the argument's own text says what is read from it.
    const argument = source?.kind === 'parsed' ? source.parameters[entry.index] : undefined;
    if (argument === undefined || source?.kind !== 'parsed') {
      return {
        kind: 'blind',
        reason: `${handlerName} is wrapped, so the scan would be reading a different function`,
        detail:
          'The route argument metadata names a parameter at index ' +
          `${String(entry.index)} that the emitted source does not carry, which is what a ` +
          'decorator replacing the method looks like. Scanning the wrapper would report its ' +
          "reads as the handler's.",
      };
    }

    const found = readsOfArgument(argument, source.body);
    if (found === undefined) {
      reads.opaque = true;
      continue;
    }
    for (const name of found) {
      reads.reads.add(location === 'header' ? name.toLowerCase() : name);
    }
  }

  const parameters: IRParameterRead[] = declared.map((parameter) => {
    // NO NESTJS BINDING READS A COOKIE, so a cookie parameter is read through paths the scan
    // does not model, middleware and session stores, and is never accounted for.
    if (parameter.in === 'cookie') {
      return { in: parameter.in, name: parameter.name, verdict: 'unaccounted' };
    }

    const reads = byLocation.get(parameter.in);
    if (reads === undefined) {
      return { in: parameter.in, name: parameter.name, verdict: 'unaccounted' };
    }

    const key = parameter.in === 'header' ? parameter.name.toLowerCase() : parameter.name;
    if (reads.reads.has(key)) return { in: parameter.in, name: parameter.name, verdict: 'read' };

    return {
      in: parameter.in,
      name: parameter.name,
      verdict: reads.opaque ? 'unaccounted' : 'not-seen-read',
    };
  });

  return { kind: 'scanned', parameters };
}

/**
 * The controller's declared scope, with the default when none was written.
 *
 * @param reflect - The metadata API
 * @param controller - The controller class
 * @returns The scope enum value
 */
function controllerScope(reflect: MetadataReflect, controller: object): number {
  const options = reflect.getMetadata(NEST_SCOPE_OPTIONS_METADATA, controller);
  if (typeof options !== 'object' || options === null) return NEST_DEFAULT_SCOPE;

  const scope = (options as { scope?: unknown }).scope;

  return typeof scope === 'number' ? scope : NEST_DEFAULT_SCOPE;
}

/** One route argument binding, reduced to what the scan reads. */
interface Binding {
  readonly type: number;
  readonly index: number;
  /** The name a decorator bound, or undefined for a whole object binding. */
  readonly data?: string;
}

/** The bindings, or the reason they cannot be trusted. */
type BindingsResult =
  | { readonly kind: 'bindings'; readonly entries: readonly Binding[] }
  | { readonly kind: 'blind'; readonly reason: string; readonly detail: string };

/**
 * Reads and classifies the route argument metadata of one handler.
 *
 * @param reflect - The metadata API
 * @param controller - The controller class
 * @param handlerName - The method name
 * @returns The bindings, or the refusal
 */
function bindingsOf(
  reflect: MetadataReflect,
  controller: object,
  handlerName: string,
): BindingsResult {
  const raw = reflect.getMetadata(NEST_ROUTE_ARGS_METADATA, controller, handlerName);
  if (raw === undefined || raw === null) return { kind: 'bindings', entries: [] };
  if (typeof raw !== 'object') {
    return {
      kind: 'blind',
      reason: 'the route argument metadata is not an object, so no binding can be read',
      detail:
        'NestJS writes one object keyed by paramtype and index. Anything else came from ' +
        'somewhere this scan does not know, and reading it as bindings would invent reads.',
    };
  }

  const entries: Binding[] = [];

  for (const [key, value] of Object.entries(raw)) {
    if (key.includes(NEST_CUSTOM_ROUTE_ARGS_MARKER)) {
      return {
        kind: 'blind',
        reason:
          'a custom parameter decorator reads the request itself, so what the handler reads ' +
          'cannot be seen',
        detail:
          'The factory behind a custom parameter decorator receives the whole execution context ' +
          'and may take anything out of it, which is an access path no scan of the handler body ' +
          'can follow. Reporting the bindings that are visible would report them as the ' +
          'complete set.',
      };
    }

    const [typeText, indexText] = key.split(':');
    const type = Number(typeText);
    const index = Number(indexText);
    if (!Number.isInteger(type) || !Number.isInteger(index)) {
      return {
        kind: 'blind',
        reason: `the binding key "${key}" is not in the form NestJS writes, so no binding can be read`,
        detail:
          'A route argument key is a paramtype and an index joined by a colon. A key in another ' +
          'shape came from somewhere this scan does not know.',
      };
    }

    if (type === NEST_ROUTE_PARAMTYPES.request || type === NEST_ROUTE_PARAMTYPES.response) {
      return {
        kind: 'blind',
        reason:
          'the handler binds the whole request or response, so any parameter is reachable ' +
          'without a binding',
        detail:
          'A handler holding the request object can read any parameter off it, so a parameter ' +
          'nothing binds cannot be told from one read that way. Nothing about unread parameters ' +
          'can be concluded, which is not the same as concluding there are none.',
      };
    }

    if (HARMLESS_TYPES.has(type)) continue;

    const held = LOCATION_TYPES.some(([, candidate]) => candidate === type);
    if (!held) {
      // A paramtype outside the table is refused rather than guessed at, per SPEC 0: a future
      // binding kind may well open the whole request the way `@Req` does.
      return {
        kind: 'blind',
        reason: `the handler binds paramtype ${String(type)}, which this scan does not know`,
        detail:
          'The paramtype table is the one this scan was written against. A binding kind outside ' +
          'it may open the whole request the way @Req does, so it is refused rather than ' +
          'passed over.',
      };
    }

    const data = (value as { data?: unknown } | null)?.data;
    entries.push({
      type,
      index,
      ...(typeof data === 'string' && data !== '' ? { data } : {}),
    });
  }

  return { kind: 'bindings', entries };
}

/** The handler source, split once into parameters and body. */
type SourceResult =
  | { readonly kind: 'parsed'; readonly parameters: readonly string[]; readonly body: string }
  | { readonly kind: 'blind'; readonly reason: string; readonly detail: string };

/**
 * Splits the emitted function into its parameter texts and its body.
 *
 * A WALK RATHER THAN A GRAMMAR, and refusal is the answer to every doubt. Parentheses, brackets,
 * braces, strings and template literals are tracked so a default value containing a comma does
 * not split a parameter; anything that leaves the walk unbalanced is a reason to be blind.
 *
 * @param handler - The handler
 * @returns The pieces, or the refusal
 */
function parseSource(handler: HandlerLike): SourceResult {
  const source = Function.prototype.toString.call(handler);
  if (source.includes('[native code]')) {
    return {
      kind: 'blind',
      reason: 'the handler is native code, so there is no source to scan',
      detail:
        'A bound, generated or native function has no body text. The scan reads the emitted ' +
        'source to see which members of a whole object binding are read, and there is none.',
    };
  }

  const open = source.indexOf('(');
  if (open === -1) {
    return {
      kind: 'blind',
      reason: 'the handler source carries no parameter list, so its arguments cannot be read',
      detail:
        'The scan splits the emitted function at its first parenthesis. A source with none is ' +
        'not a function this scan understands.',
    };
  }

  const parameters: string[] = [];
  let depth = 0;
  let start = open + 1;
  let at = open;
  let close = -1;

  while (at < source.length) {
    const skipped = skipAtom(source, at);
    if (skipped === undefined) {
      return {
        kind: 'blind',
        reason: 'the handler source does not scan as balanced text, so it cannot be split',
        detail:
          'Parentheses, brackets, braces, strings and template literals are tracked so a default ' +
          'value holding a comma does not split a parameter. Anything that leaves the walk ' +
          'unbalanced is a doubt, and a doubt is answered by refusing.',
      };
    }
    if (skipped > at) {
      at = skipped;
      continue;
    }

    const char = source[at];
    if (char === '(' || char === '[' || char === '{') depth += 1;
    else if (char === ')' || char === ']' || char === '}') {
      depth -= 1;
      if (depth === 0 && char === ')') {
        close = at;
        break;
      }
    } else if (char === ',' && depth === 1) {
      parameters.push(source.slice(start, at).trim());
      start = at + 1;
    }

    at += 1;
  }

  if (close === -1) {
    return {
      kind: 'blind',
      reason: 'the handler source does not close its parameter list, so it cannot be split',
      detail:
        'The walk reached the end of the emitted text with the parameter list still open, which ' +
        'is text this scan does not understand rather than a handler with no parameters.',
    };
  }

  const last = source.slice(start, close).trim();
  if (last !== '') parameters.push(last);

  return { kind: 'parsed', parameters, body: source.slice(close + 1) };
}

/**
 * Skips a string, template literal or comment starting at one position.
 *
 * @param source - The whole source
 * @param at - The position
 * @returns The position after the atom, `at` when none starts here, undefined when unterminated
 */
function skipAtom(source: string, at: number): number | undefined {
  const char = source[at];

  if (char === "'" || char === '"' || char === '`') {
    let cursor = at + 1;
    while (cursor < source.length) {
      if (source[cursor] === '\\') cursor += 2;
      else if (source[cursor] === char) return cursor + 1;
      else cursor += 1;
    }
    return undefined;
  }

  if (char === '/' && source[at + 1] === '/') {
    const end = source.indexOf('\n', at);
    return end === -1 ? source.length : end + 1;
  }

  if (char === '/' && source[at + 1] === '*') {
    const end = source.indexOf('*/', at + 2);
    return end === -1 ? undefined : end + 2;
  }

  return at;
}

/**
 * What a whole object argument's text and the body say is read from it.
 *
 * @param argument - The parameter text at the binding's index
 * @param body - The function body
 * @returns The property names read, or undefined when the argument is used opaquely
 */
function readsOfArgument(argument: string, body: string): readonly string[] | undefined {
  // Strip a default value: `q = {}` binds `q`. The destructuring case keeps its own defaults.
  const bare = argument.startsWith('{') ? argument : (argument.split('=')[0] ?? '').trim();

  if (bare.startsWith('{')) return destructuredNames(bare);

  if (!/^[A-Za-z_$][\w$]*$/.test(bare)) return undefined;

  return propertyReads(bare, body);
}

/**
 * The top level property names of a destructuring pattern.
 *
 * `{ sort, filter: f, page = 1 }` reads sort, filter and page; a rest element or a computed key
 * makes the rest of the object reachable, so the pattern is opaque.
 *
 * @param pattern - The parameter text, starting with `{`
 * @returns The names, or undefined when the pattern reaches more than it names
 */
function destructuredNames(pattern: string): readonly string[] | undefined {
  const inner = pattern.replace(/^\{/, '').replace(/\}[\s\S]*$/, '');
  const names: string[] = [];

  let depth = 0;
  let start = 0;
  const pieces: string[] = [];
  for (let at = 0; at < inner.length; at += 1) {
    const char = inner[at];
    if (char === '{' || char === '[' || char === '(') depth += 1;
    else if (char === '}' || char === ']' || char === ')') depth -= 1;
    else if (char === ',' && depth === 0) {
      pieces.push(inner.slice(start, at));
      start = at + 1;
    }
  }
  pieces.push(inner.slice(start));

  for (const piece of pieces) {
    const text = piece.trim();
    if (text === '') continue;
    if (text.startsWith('...')) return undefined;
    if (text.startsWith('[')) return undefined;

    const name = /^(['"]?)([\w$-]+)\1\s*[:=]?/.exec(text)?.[2];
    if (name === undefined) return undefined;
    names.push(name);
  }

  return names;
}

/**
 * Every property read of one identifier in a body, or opacity when it is used any other way.
 *
 * THE BODY IS SCANNED RAW. An occurrence inside a string over-counts a read or an opacity, and
 * both directions suppress findings rather than create them, per the file note.
 *
 * @param identifier - The argument's name
 * @param body - The function body
 * @returns The names read, or undefined on any use that is not a property access
 */
function propertyReads(identifier: string, body: string): readonly string[] | undefined {
  const names: string[] = [];
  const occurrence = new RegExp(`(^|[^\\w$.])${escapeRegExp(identifier)}(?![\\w$])`, 'g');

  for (const match of body.matchAll(occurrence)) {
    const after = body.slice(match.index + match[0].length);

    const direct = /^\s*\??\.\s*([A-Za-z_$][\w$]*)/.exec(after);
    if (direct?.[1] !== undefined) {
      names.push(direct[1]);
      continue;
    }

    const computed = /^\s*(?:\?\.)?\[\s*(['"])((?:(?!\1)[^\\]|\\.)*)\1\s*\]/.exec(after);
    if (computed?.[2] !== undefined) {
      names.push(computed[2]);
      continue;
    }

    return undefined;
  }

  return names;
}

/**
 * Escapes an identifier for use inside a regular expression.
 *
 * An identifier can carry `$`, which is a regex anchor. Nothing else in the identifier grammar
 * needs escaping, and escaping everything is cheaper than remembering that.
 *
 * @param text - The identifier
 * @returns The escaped form
 */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
