/**
 * `sourceCollector()`, the first collector of SPEC 6.2 and the one T018 calls the highest value
 * to cost ratio in the milestone.
 *
 * NO SPECIFICATION RENDERER CAN DO THIS, BY DEFINITION, and that is not a slogan. The OpenAPI
 * document contains no reference to the code that serves the endpoint, because there is no field
 * for one and no way to fill it: the file is a description of an HTTP surface, written to be
 * publishable without the implementation. Only a process that has both the document and the
 * running application can put them side by side, which is what this collector is.
 *
 * THE CLASS IT NAMES IS THE ONE THE METHOD IS WRITTEN ON, NOT THE ONE IT IS SERVED FROM. With
 * `class OrdersController extends CrudController` and `findAll` inherited, the route belongs to
 * `OrdersController` and the method body is in `crud.controller.ts`. SPEC 6.3's `source` is where
 * to find the code, so it says `CrudController`, and the file and the line agree with it. The
 * registered class is not lost: the pairing already used it to attach this node, and every other
 * collector still sees it as `context.controller`.
 *
 * IT EMITS WHAT IT HAS AND NEVER MORE, per SPEC 6.1. Three outcomes and they are distinct: the
 * class, the method, the file and the line, which is the ordinary case; the class, the method and
 * the file, when a source map is named and cannot be read; and the class and the method alone,
 * when the handler could not be located at all. The first two produce a link and the third does
 * not, and none of them invents a line number.
 *
 * A BUILD WITH NO SOURCE MAPS IS THE FIRST CASE AND NOT THE SECOND, which is worth saying because
 * the opposite is the natural guess. With no map the emitted JavaScript is the source: the file is
 * `dist/serve.js`, the line is a line of `dist/serve.js`, and the two agree. Reporting a file
 * link there would throw away a precise answer, and reporting a TypeScript line number for a file
 * that has none would be the invention this collector exists to avoid. The NestJS 10 arm of the
 * compatibility matrix is built that way on purpose and pins it.
 *
 * NO `IRFact` HERE, AND THAT IS THE SHAPE SPEC 6.3 FIXES RATHER THAN AN OMISSION. `source` is the
 * one field of `IRNodeRuntime` that carries no confidence, because there is nothing to be
 * uncertain about: V8 was asked where the function is and it either answered or it did not.
 */

import type { IRNodeRuntime, IRSourceLocation } from '@openref/core';
import type { CollectorContext, IRuntimeCollector } from '../../application/ports/collector.port';
import type { HandlerLike } from '../../../shared/types/nest-surface';
import {
  locateFunction,
  type FunctionLocation,
  type FunctionLocationResult,
} from '../adapters/function-location.adapter';
import { findRepositoryRoot, isSubmoduleRoot } from '../adapters/repository.adapter';
import { repositoryRelative } from '../../domain/repository-path';

/** The name this collector stamps on everything it reports, per SPEC 6.2. */
export const SOURCE_COLLECTOR_NAME = 'sourceCollector';

/** What a host may tell the collector that it cannot work out for itself. */
export interface SourceCollectorOptions {
  /**
   * The repository root, when the walk for `.git` would find the wrong one or none.
   *
   * A container that copies the built tree without `.git`, and a checkout whose root is above a
   * mount point, are the two cases. Given one, the collector expresses every file relative to it
   * and never walks.
   */
  readonly repositoryRoot?: string;

  /**
   * Whether the absolute path of this machine may enter the document, per SPEC 6.3.
   *
   * FALSE BY DEFAULT AND IT IS THE ONLY WAY TO TURN IT ON. An absolute path is a fact about the
   * machine that built the reference, not about the API it describes: it publishes a directory
   * layout, a user name and often a project name to everyone the page is served to, and a link
   * into somebody else's filesystem is worse than no link because the reader has no such path.
   *
   * WHAT IT BUYS IS THE EDITOR FORM OF SPEC 6.3, and that is the whole of it. A reference read on
   * the machine that built it can open `vscode://file/...` and needs no git, no push and no
   * forge; a reference served to a team wants the forge URL and leaves this alone.
   *
   * THE OTHER HALF OF THE OPT IN IS THE TEMPLATE. Nothing here checks it, because the collector
   * does not see it: a template naming `{absolutePath}` with this left off produces no link and
   * `expandSourceLink` says which option is missing.
   */
  readonly absolutePath?: boolean;

  /**
   * How a function is located. Injected by the tests, and by nothing else.
   *
   * IT IS AN OPTION SO THAT THE COLLECTOR'S OWN RULES CAN BE TESTED WITHOUT V8. The inherited
   * handler case, the two controllers sharing a method name, the degradation to a file and the
   * refusal to invent a line are rules of this file, and asserting them through a real inspector
   * session would make each one a test of the locator as well.
   */
  readonly locate?: (handler: HandlerLike) => FunctionLocationResult;
}

/** What the collector could not do, kept per node so that T022 can report it. */
export interface SourceCollectorProblem {
  /** `OrdersController.list`, as a reader recognises it. */
  readonly subject: string;
  readonly reason: string;
}

/** The collector, with the record of everything it could not resolve. */
export interface SourceCollector extends IRuntimeCollector {
  /**
   * Everything that could not be located, in the order it was met.
   *
   * A LIST RATHER THAN A LOG, for the reason the discovery pass keeps one. "This endpoint has no
   * source link" and "this endpoint was never looked at" are different states, and `doctor` from
   * T022 is what tells a reader which one they are in.
   */
  problems(): readonly SourceCollectorProblem[];
}

/**
 * Builds the source collector.
 *
 * @param options - What the host knows that the collector cannot work out
 * @returns The collector, ready to register in `runtime.collectors`
 */
export function sourceCollector(options: SourceCollectorOptions = {}): SourceCollector {
  const locate = options.locate ?? locateFunction;
  const problems: SourceCollectorProblem[] = [];

  return {
    name: SOURCE_COLLECTOR_NAME,

    collect(context: CollectorContext): IRNodeRuntime | undefined {
      const source = sourceFor(context, locate, options, problems);

      return { source };
    },

    problems(): readonly SourceCollectorProblem[] {
      return problems;
    },
  };
}

/**
 * Builds the `source` field for one node.
 *
 * @param context - What the registry handed over
 * @param locate - The locator
 * @param options - What the host configured, which decides whether this machine may be named
 * @param problems - Accumulator for what could not be resolved
 * @returns The source, which always names the class and the method
 */
function sourceFor(
  context: CollectorContext,
  locate: (handler: HandlerLike) => FunctionLocationResult,
  options: SourceCollectorOptions,
  problems: SourceCollectorProblem[],
): IRSourceLocation {
  const controller = context.declaredOn.name;
  const handler = context.handlerName;
  const subject = `${controller}.${handler}`;
  const named = { controller, handler };

  const found = locate(context.handler);
  if (found.location === undefined) {
    problems.push({ subject, reason: found.reason ?? 'the handler could not be located' });
    return named;
  }

  // A locator that found a file and no line reports both: the file is usable and the reason names
  // what is missing, so the record says the link is a file link on purpose.
  if (found.reason !== undefined) problems.push({ subject, reason: found.reason });

  const machine = machinePosition(found.location, options.absolutePath === true);
  const configuredRoot = options.repositoryRoot;

  const root = configuredRoot ?? findRepositoryRoot(found.location.file);
  if (root === undefined) {
    problems.push({
      subject,
      reason:
        `no .git was found above "${found.location.file}", so the path cannot be expressed ` +
        'relative to a repository and no forge link can be built. Set repositoryRoot on ' +
        'sourceCollector when the build has no git directory, or use the editor form of SPEC 6.3, ' +
        'which needs no repository at all',
    });
    return { ...named, ...machine };
  }

  const file = repositoryRelative(found.location.file, root);
  if (file === undefined) {
    problems.push({
      subject,
      reason:
        `the handler is at "${found.location.file}", which is outside the repository at ` +
        `"${root}". A link built from it would leave the forge's own tree`,
    });
    return { ...named, ...machine };
  }

  // A SUBMODULE'S ROOT IS A REPOSITORY AND IT IS NOT THE ONE THE TEMPLATE NAMES, per SPEC 6.3 and
  // T025. The path and the revision would both be the submodule's, substituted into the
  // superproject's forge URL, so the link resolves to a different repository's file or to nothing.
  if (configuredRoot === undefined && isSubmoduleRoot(root)) {
    problems.push({
      subject,
      reason:
        `the handler is inside the submodule at "${root}", whose paths and revision belong to a ` +
        'different repository than the one sourceLink names. Set repositoryRoot on ' +
        'sourceCollector, or configure a template for that repository',
    });
    return { ...named, ...machine };
  }

  // AN ABSOLUTE PATH GETS THIS FAR ONLY BEHIND THE OPT IN, and `{file}` is what a served document
  // otherwise carries: a path from the repository root and nothing about the machine that built it.
  return {
    ...named,
    file,
    ...(found.location.line === undefined ? {} : { line: found.location.line }),
    ...machine,
  };
}

/**
 * The half of a location that names this machine rather than the repository.
 *
 * THE THREE REFUSALS ABOVE REFUSE A LINK AND NOT A LOCATION, which is the shape change `T018-R1`
 * made and SPEC 6.3 records. No repository root, a file outside the repository, and a handler in
 * a submodule all mean "no forge URL can be built from this", and in all three the position is
 * still true and an editor can still open it. Before this, all three threw the position away.
 *
 * THE LINE TRAVELS WITH THE PATH AND NOT ON ITS OWN. A line with neither `file` nor
 * `absolutePath` beside it names a position in no file, which says nothing to any reader and
 * nothing to `expandSourceLink`.
 *
 * @param location - What the locator found
 * @param included - Whether the host opted in to the absolute path
 * @returns The absolute path, its line and its column, or nothing at all
 */
function machinePosition(
  location: FunctionLocation,
  included: boolean,
): Pick<IRSourceLocation, 'absolutePath' | 'line' | 'column'> {
  if (!included) return {};

  return {
    absolutePath: location.file,
    ...(location.line === undefined ? {} : { line: location.line }),
    ...(location.column === undefined ? {} : { column: location.column }),
  };
}
