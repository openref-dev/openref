import type { IRConfidence, IRFact, IRNode, IRNodeRuntime } from '@openref/core';
import type {
  ControllerLike,
  HandlerLike,
  ModuleRefLike,
  ReflectorLike,
} from '../../../shared/types/nest-surface';

/**
 * The collector contract of SPEC 6.2, and public API from this point.
 *
 * FROZEN. A third party writes a collector against this file and publishes it, so a change to
 * any shape here is a major version of `@openref/nest`. `test/unit/collector-contract.spec.ts`
 * is the pin, and `pnpm lint` typechecks the test tree, so a change fails to compile rather
 * than quietly breaking every ecosystem collector built against it.
 *
 * THE CONTRACT IS TWO MEMBERS AND NOT MORE, deliberately. Everything a collector needs to be
 * useful arrives in {@link CollectorContext}, so growing a collector's abilities is a change to
 * the context rather than to the interface every third party implements.
 *
 * WHAT A COLLECTOR MAY NOT DO, ENFORCED BY THE TYPES RATHER THAN BY A RULE. It cannot return a
 * fact without provenance: every field of `IRNodeRuntime` that carries a value carries it in an
 * {@link IRFact}, and there is no overload, no union and no cast anywhere in this file that
 * admits a bare value. Per SPEC 6.1 the three confidence levels are the whole set.
 */

/**
 * What a collector is given for one node.
 *
 * ALL FIVE ARE PRESENT OR THE COLLECTOR IS NOT RUN. A context with a missing reflector would
 * push a null check into every collector ever written, including third party ones, and the
 * first one to skip it would read metadata off `undefined` in a consumer's boot. The registry
 * is the one place that decides whether a runtime pass is possible at all.
 */
export interface CollectorContext {
  /**
   * The node as the normalizer produced it, before any runtime fact was attached.
   *
   * NORMALIZED AND NOT RAW, per T017's own definition. A collector comparing what the
   * application does against what the document says needs both in the same vocabulary, and the
   * specification's vocabulary is not it: `$ref` is resolved, styles carry their defaults, and
   * the operation id is the one the reference routes by.
   */
  readonly node: IRNode;

  /** The controller class the route was registered as, which is what the document names. */
  readonly controller: ControllerLike;

  /**
   * The class the handler is written on, which is {@link controller} unless it was inherited.
   *
   * ADDED IN T018, AND THE ADDITION IS WHAT THE CONTRACT'S OWN NOTE ANTICIPATES: growing a
   * collector's abilities is a change to the context rather than to the interface every third
   * party implements. A collector only ever reads this, so one written against the context
   * without it still compiles and still runs.
   *
   * TWO CLASSES BECAUSE THEY ANSWER TWO QUESTIONS, and a source link needs the second one. When
   * `OrdersController extends CrudController` and the handler is `CrudController.findAll`, the
   * document says `OrdersController` and the file holding the method body is the base class's.
   * Linking to the subclass's file would land a reader on a class that does not contain the
   * method they clicked.
   */
  readonly declaredOn: ControllerLike;

  /** The route handler itself, which is the target most Nest metadata is set on. */
  readonly handler: HandlerLike;

  /**
   * The method name, as the prototype holds it.
   *
   * NOT `handler.name`, WHICH IS ONLY USUALLY THE SAME. A decorator that replaces the property
   * descriptor rather than only setting metadata hands over a wrapper, and a wrapper's `name` is
   * whatever the decorator's author called it or the empty string. The property name is what
   * NestJS routes by and what `@nestjs/swagger` puts in the operation id, so it is the one a
   * reader recognises.
   */
  readonly handlerName: string;

  /** Nest's `Reflector`, narrowed in `shared/types/nest-surface.ts`. */
  readonly reflector: ReflectorLike;

  /** Nest's `ModuleRef`, for a collector that has to resolve a provider to read its config. */
  readonly moduleRef: ModuleRefLike;

  /**
   * Class names of the guards registered for the whole application, per SPEC 6.2.1.
   *
   * ADDED IN TX-GLOBALGUARD, AND THE SECOND TIME THE CONTRACT'S OWN NOTE HELD: growing a
   * collector's abilities is a change to this context rather than to the interface every third
   * party implements, so a collector written before it still compiles and still runs.
   *
   * IT IS ON THE CONTEXT RATHER THAN LOOKED UP BY THE COLLECTOR because the answer is one
   * registration for the whole application and identical on every node. A collector walking the
   * container per node would ask a thousand times for a list that cannot have changed, and every
   * third party collector that wanted the same fact would have to walk it again.
   *
   * EMPTY MEANS NONE WERE REGISTERED, and there is no third state. The pass reads them once and
   * always passes a list, so a collector cannot be handed `undefined` and left to guess whether
   * that means "none" or "not looked at".
   */
  readonly globalGuards: readonly string[];

  /**
   * Builds a fact, filling in the name of the collector that is running.
   *
   * SUGAR OVER THE REGISTRY'S STAMP AND NOT A SECOND MECHANISM. The registry rewrites the
   * `collector` field of every fact it merges, because the type alone cannot stop a collector
   * writing an object literal with somebody else's name in it. This exists so the ordinary way
   * of writing a collector is also the correct one.
   */
  readonly fact: <T>(value: T, confidence: IRConfidence) => IRFact<T>;
}

/**
 * One collector.
 *
 * @see CollectorContext for what it is given.
 */
export interface IRuntimeCollector {
  /**
   * Stable identifier, and the value that lands in every fact this collector produces.
   *
   * It is what `doctor` prints and what the UI shows beside a fact, so it names the source
   * rather than the package: `throttlerCollector`, not `@nestjs/throttler`.
   */
  readonly name: string;

  /**
   * Reads what this collector knows about one node.
   *
   * @param context - The node and the application objects behind it
   * @returns The facts it found, or `undefined` when it has nothing to say about this node
   */
  collect(context: CollectorContext): IRNodeRuntime | undefined;
}

/**
 * A collector that did not load, with the reason, per SPEC 6.2.
 *
 * The absence of an optional package in a consumer's project must not break the boot, and the
 * shape that keeps it honest is this one rather than a silent `undefined`: the collector still
 * appears in `IRRuntimeMeta.skipped`, so `doctor` can say "throttler facts are missing because
 * `@nestjs/throttler` is not installed" instead of leaving a reader to notice an empty panel.
 *
 * A factory returns this when its package is absent. It never throws, and the registry never
 * calls it.
 */
export interface SkippedCollector {
  readonly name: string;
  /** Why it did not load, phrased for a reader of `doctor` rather than for a log. */
  readonly skipped: string;
}

/**
 * What may be handed to the registry.
 *
 * `undefined` is admitted so a conditional registration reads as one, rather than forcing a
 * caller to filter a list before passing it. It is dropped without a record; a collector that
 * wants to be reported returns a {@link SkippedCollector} instead.
 */
export type CollectorRegistration = IRuntimeCollector | SkippedCollector | undefined;

/**
 * Reports whether a registration is a collector that will be run.
 *
 * @param registration - Whatever the host registered
 * @returns True when it has a `collect`
 */
export function isRuntimeCollector(
  registration: CollectorRegistration,
): registration is IRuntimeCollector {
  return registration !== undefined && 'collect' in registration;
}

/**
 * Reports whether a registration declined to load and said why.
 *
 * @param registration - Whatever the host registered
 * @returns True when it carries a reason
 */
export function isSkippedCollector(
  registration: CollectorRegistration,
): registration is SkippedCollector {
  return registration !== undefined && 'skipped' in registration;
}
