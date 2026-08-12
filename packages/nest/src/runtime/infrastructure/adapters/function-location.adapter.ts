/**
 * Where a function is written, asked of V8 rather than guessed at.
 *
 * THIS IS THE PART OF T018 THAT LOOKS IMPOSSIBLE AND IS NOT. A JavaScript function does not carry
 * its file and line: `Function.prototype.toString` gives the text, `Error.stack` gives where a
 * call happened rather than where a function was written, and neither says which file. V8 knows,
 * and the only public way to ask it is the inspector protocol: `[[FunctionLocation]]` is an
 * internal property, visible through `Runtime.getProperties` and nowhere else.
 *
 * IT IS THE IN PROCESS INSPECTOR AND IT IS SYNCHRONOUS. `node:inspector`'s `Session` connects to
 * the V8 inspector of this process with no port, no listener and nothing to attach to from
 * outside. Every `post` callback here fires before `post` returns, which is what makes this usable
 * at all: SPEC 13.1 requires `setup` to stay synchronous, and the runtime pass runs inside it.
 *
 * THE SESSION IS OPENED LATE AND CLOSED AS SOON AS THE PASS STOPS ASKING, which is the one thing
 * about this file that is not obvious. `Debugger.enable` is not free: it makes V8 keep debug
 * information it would otherwise drop, and leaving it on for the life of a consumer's production
 * process would be a cost this package imposed and never mentioned. The runtime pass is
 * synchronous and runs once, so a microtask scheduled after the last lookup runs when the pass has
 * finished, and closes the session. Nothing has to tell this file when the pass ended.
 *
 * A COMPILED APPLICATION IS THE ORDINARY CASE, so the answer is put back through the source map.
 * `node:module` exports `SourceMap`, and reading the `sourceMappingURL` off the parsed script and
 * constructing one directly avoids `process.setSourceMapsEnabled(true)`, which is a process wide
 * change this package has no business making inside somebody else's application.
 *
 * WHEN THE ANSWER IS NOT AVAILABLE IT SAYS SO, per CLAUDE.md's rule against runtime magic. A
 * source map that maps nothing at this position gives neither a file nor a line in the terms the
 * reader's repository is written in, and reporting the compiled position instead would link a
 * reader to a `dist/` path that is usually not committed at all.
 */

import { readFileSync } from 'node:fs';
import { Session } from 'node:inspector';
import { SourceMap, type SourceMapping, type SourceMapPayload } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { HandlerLike } from '../../../shared/types/nest-surface';

/** Where a function is written, in the terms the repository is written in. */
export interface FunctionLocation {
  /** Absolute path of the file holding the function. */
  readonly file: string;
  /** One based line, absent when only the file could be resolved. */
  readonly line?: number;
}

/** The answer, or why there is none. The two are never both present and never both absent. */
export interface FunctionLocationResult {
  readonly location?: FunctionLocation;
  /** Why nothing was found, phrased for a reader of `doctor`. */
  readonly reason?: string;
}

/** How a located function is handed to the inspector, since it evaluates expressions not values. */
const HANDOVER_KEY = '__openrefFunctionUnderInspection';

/** One script, as `Debugger.scriptParsed` reported it. */
interface ParsedScript {
  readonly url: string;
  readonly sourceMapURL: string;
}

/** `[[FunctionLocation]]`, which is zero based on both axes. */
interface RawLocation {
  readonly scriptId: string;
  readonly lineNumber: number;
  readonly columnNumber: number;
}

/**
 * The V8 session, its script table, and the microtask that will close them.
 *
 * A module level value rather than a field, because the pass constructs collectors through a
 * factory the host calls and there is no object whose lifetime matches a pass.
 */
let open: OpenSession | undefined;

/** An inspector session that is currently attached. */
interface OpenSession {
  readonly session: Session;
  readonly scripts: Map<string, ParsedScript>;
  /** Set while a close is scheduled, so a later lookup can cancel it. */
  closing: boolean;
}

/**
 * Finds where a function is written.
 *
 * @param fn - The function, ordinarily a route handler off a controller's prototype
 * @returns Its location, or the reason there is none
 */
export function locateFunction(fn: HandlerLike): FunctionLocationResult {
  const attached = attach();
  if (attached.session === undefined) {
    return { reason: attached.reason ?? 'no inspector session could be attached' };
  }

  try {
    const raw = rawLocationOf(attached.session, fn);
    if (raw === undefined) {
      return {
        reason:
          'V8 reported no [[FunctionLocation]] for the handler, which happens for a native ' +
          'function or one produced by a bound or generated wrapper',
      };
    }

    const script = attached.session.scripts.get(raw.scriptId);
    if (script === undefined) {
      return { reason: `the inspector reported script ${raw.scriptId}, which it never parsed` };
    }

    return resolve(script, raw);
  } finally {
    scheduleClose();
  }
}

/**
 * Closes the session now rather than waiting for the scheduled close.
 *
 * Exists for the tests, which assert that nothing is left attached, and for a host that wants the
 * debug information dropped at a moment of its own choosing.
 */
export function closeFunctionLocator(): void {
  if (open === undefined) return;

  try {
    open.session.post('Debugger.disable', () => undefined);
    open.session.disconnect();
  } catch {
    // Disconnecting a session that is already gone is not a failure worth reporting: the only
    // thing this function promises is that nothing is attached afterwards.
  }

  open = undefined;
}

/** What {@link attach} produced. */
interface Attached {
  readonly session?: OpenSession;
  readonly reason?: string;
}

/**
 * Connects a session and enables the debugger, once.
 *
 * @returns The open session, or why one could not be opened
 */
function attach(): Attached {
  if (open !== undefined) {
    open.closing = false;
    return { session: open };
  }

  try {
    // THE CONSTRUCTION IS INSIDE THE TRY AND THE IMPORT IS NOT, which is the right split here and
    // is worth saying because the NestJS load in this directory made the opposite choice. That one
    // is lazy because `tools/browser-budget` imports this package with no NestJS installed at all.
    // `node:inspector` is a builtin of every runtime this package supports and the browser bundle
    // is a separate entry that never reaches this file, so importing it costs nothing. What can
    // fail is attaching: a hardened runtime may refuse to connect a session, and that costs one
    // collector rather than the boot.
    const session = new Session();
    session.connect();

    const scripts = new Map<string, ParsedScript>();
    session.on('Debugger.scriptParsed', (message) => {
      scripts.set(message.params.scriptId, {
        url: message.params.url,
        sourceMapURL: message.params.sourceMapURL ?? '',
      });
    });

    // Every script V8 has already parsed is replayed to this listener before `post` returns, which
    // is why the table is complete for handlers defined long before this ran.
    let failed: string | undefined;
    session.post('Debugger.enable', (error) => {
      if (error) failed = error.message;
    });

    if (failed !== undefined) {
      session.disconnect();
      return { reason: `the V8 debugger could not be enabled: ${failed}` };
    }

    open = { session, scripts, closing: false };
    return { session: open };
  } catch (cause) {
    return {
      reason: `node:inspector is not usable in this runtime: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    };
  }
}

/**
 * Arranges for the session to be closed once the current synchronous run finishes.
 *
 * THE PASS IS SYNCHRONOUS AND THAT IS WHAT MAKES THIS EXACT. `runRuntimePass` walks every node
 * without awaiting anything, so the microtask queue is not reached until the last handler has been
 * located. A lookup arriving before then finds `closing` set and clears it.
 */
function scheduleClose(): void {
  if (open === undefined || open.closing) return;

  open.closing = true;
  queueMicrotask(() => {
    if (open?.closing === true) closeFunctionLocator();
  });
}

/**
 * Asks V8 for `[[FunctionLocation]]`.
 *
 * THE FUNCTION IS PARKED ON `globalThis` BECAUSE THE PROTOCOL EVALUATES TEXT. `Runtime.evaluate`
 * takes an expression, not a value, so the only way to hand it a particular function object is to
 * make one expression name it. The key is removed again in the same synchronous run, before any
 * other code can observe it.
 *
 * @param attached - The open session
 * @param fn - The function to locate
 * @returns The raw location, or undefined when V8 has none
 */
function rawLocationOf(attached: OpenSession, fn: HandlerLike): RawLocation | undefined {
  const globals = globalThis as unknown as Record<string, unknown>;
  globals[HANDOVER_KEY] = fn;

  let objectId: string | undefined;
  try {
    attached.session.post(
      'Runtime.evaluate',
      { expression: `globalThis.${HANDOVER_KEY}` },
      (error, result) => {
        if (!error) objectId = result.result.objectId;
      },
    );
  } finally {
    // `Reflect.deleteProperty` rather than `delete`, which the linter refuses on a computed key
    // for a good reason that does not apply to a module level constant. The removal is in a
    // `finally` so that a throwing `post` cannot leave a handler parked on the global object.
    Reflect.deleteProperty(globals, HANDOVER_KEY);
  }

  if (objectId === undefined) return undefined;

  let raw: RawLocation | undefined;
  attached.session.post(
    'Runtime.getProperties',
    { objectId, ownProperties: false },
    (error, result) => {
      if (error) return;

      const found = result.internalProperties?.find(
        (property) => property.name === '[[FunctionLocation]]',
      );
      raw = asRawLocation(found?.value?.value);
    },
  );

  return raw;
}

/**
 * Narrows whatever the protocol returned into a location.
 *
 * @param value - The `[[FunctionLocation]]` value
 * @returns The location, or undefined when it is not one
 */
function asRawLocation(value: unknown): RawLocation | undefined {
  if (typeof value !== 'object' || value === null) return undefined;

  const candidate = value as Partial<RawLocation>;
  if (typeof candidate.scriptId !== 'string') return undefined;
  if (typeof candidate.lineNumber !== 'number') return undefined;
  if (typeof candidate.columnNumber !== 'number') return undefined;

  return {
    scriptId: candidate.scriptId,
    lineNumber: candidate.lineNumber,
    columnNumber: candidate.columnNumber,
  };
}

/**
 * Turns a position in a parsed script into a position in the source.
 *
 * @param script - The script the function is in
 * @param raw - Its zero based position in that script
 * @returns The location in source terms, or why there is none
 */
function resolve(script: ParsedScript, raw: RawLocation): FunctionLocationResult {
  const compiled = pathOf(script.url);
  if (compiled === undefined) {
    return {
      reason:
        `the handler is in "${script.url}", which is not a file. A handler defined in an eval ` +
        'or in a module built at runtime has no place in a repository to link to',
    };
  }

  if (script.sourceMapURL === '') {
    // No map, so the script is the source. This is `ts-node`, `tsx`, plain JavaScript, and any
    // build that emits no maps at all.
    return { location: { file: compiled, line: raw.lineNumber + 1 } };
  }

  const map = mapFor(script);
  if (map === undefined) {
    return { location: { file: compiled }, ...noMapReason(script) };
  }

  // `findEntry` answers with an empty object when the position maps to nothing, which its type
  // states as a union rather than as optional fields.
  const entry: Partial<SourceMapping> = map.map.findEntry(raw.lineNumber, raw.columnNumber);
  const originalSource = entry.originalSource;
  if (typeof originalSource !== 'string' || typeof entry.originalLine !== 'number') {
    return {
      reason:
        `the source map beside "${compiled}" has no entry for line ${String(raw.lineNumber + 1)}, ` +
        'so the position in the original file is unknown. Reporting the compiled path instead ' +
        'would link a reader to a build directory rather than to the code',
    };
  }

  const original = pathOf(new URL(originalSource, map.base).href);
  if (original === undefined) {
    return {
      reason: `the source map names "${originalSource}", which does not resolve to a file`,
    };
  }

  return { location: { file: original, line: entry.originalLine + 1 } };
}

/** A parsed source map and the URL its `sources` are relative to. */
interface LoadedMap {
  readonly map: SourceMap;
  readonly base: string;
}

/** Parsed maps, keyed by the `sourceMappingURL` they came from. */
const maps = new Map<string, LoadedMap | undefined>();

/**
 * Reads and parses the source map of one script.
 *
 * Cached, because every handler of a controller is in the same file and a map for a bundled
 * application is large enough that parsing it per operation would be felt.
 *
 * @param script - The parsed script
 * @returns The map and its base URL, or undefined when it cannot be read
 */
function mapFor(script: ParsedScript): LoadedMap | undefined {
  const key = `${script.url}\0${script.sourceMapURL}`;
  if (maps.has(key)) return maps.get(key);

  const loaded = loadMap(script);
  maps.set(key, loaded);

  return loaded;
}

/**
 * Loads a source map, inline or beside the file.
 *
 * @param script - The parsed script
 * @returns The map and its base URL, or undefined
 */
function loadMap(script: ParsedScript): LoadedMap | undefined {
  try {
    if (script.sourceMapURL.startsWith('data:')) {
      const comma = script.sourceMapURL.indexOf(',');
      if (comma === -1) return undefined;

      const body = script.sourceMapURL.slice(comma + 1);
      const header = script.sourceMapURL.slice(0, comma);
      const text = header.endsWith(';base64')
        ? Buffer.from(body, 'base64').toString('utf8')
        : decodeURIComponent(body);

      // An inline map's `sources` are relative to the file that carries it.
      return { map: new SourceMap(JSON.parse(text) as SourceMapPayload), base: script.url };
    }

    const absolute = new URL(script.sourceMapURL, script.url);
    const path = pathOf(absolute.href);
    if (path === undefined) return undefined;

    return {
      map: new SourceMap(JSON.parse(readFileSync(path, 'utf8')) as SourceMapPayload),
      base: absolute.href,
    };
  } catch {
    return undefined;
  }
}

/**
 * The reason a map was named and could not be read, for the file only degradation.
 *
 * @param script - The parsed script
 * @returns A one field object, so it can be spread into a result
 */
function noMapReason(script: ParsedScript): { readonly reason: string } {
  return {
    reason:
      `the script names a source map at "${script.sourceMapURL}" that could not be read, so the ` +
      'line is the compiled one and is not reported. The link points at the file',
  };
}

/**
 * Turns a script URL into a path, when it is one.
 *
 * @param url - Whatever the inspector called the script
 * @returns The absolute path, or undefined for anything that is not a file
 */
function pathOf(url: string): string | undefined {
  if (url === '') return undefined;

  try {
    if (url.startsWith('file:')) return fileURLToPath(url);
  } catch {
    return undefined;
  }

  // V8 reports a plain absolute path for a script Node loaded through CommonJS.
  return url.startsWith('/') || /^[A-Za-z]:[\\/]/.test(url) ? url : undefined;
}
