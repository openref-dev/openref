import type {
  IRConfidence,
  IRFact,
  IRHealthCheck,
  IRNodeRuntime,
  IRRuntimeMeta,
} from '@openref/core';
import type {
  CollectorContext,
  CollectorRegistration,
  IRuntimeCollector,
} from '../ports/collector.port';
import { isRuntimeCollector, isSkippedCollector } from '../ports/collector.port';
import { mergeContributions, type Contribution } from '../../domain/merge';
import type {
  ControllerLike,
  HandlerLike,
  ModuleRefLike,
  ReflectorLike,
} from '../../../shared/types/nest-surface';
import type { IRNode } from '@openref/core';

/**
 * Runs the collectors of SPEC 6.2 and merges what they return.
 *
 * FAIL OPEN, WHICH IS THE OPPOSITE OF THE NORMALIZER AND DELIBERATELY SO. A broken
 * specification must not render as though it were fine, because the document is the product. A
 * collector is an augmentation of a document that already renders, so a collector that throws
 * costs a panel, and taking a consumer's application down over it would trade the whole
 * reference for one fact. STANDARDS 8 states both policies together for exactly this reason.
 *
 * A FAILURE IS RECORDED ONCE AND THE COLLECTOR IS RETIRED. A collector that throws on the first
 * node throws on the thousandth, and a report carrying the same failure a thousand times is a
 * report nobody reads. It is disabled for the rest of the pass, its reason is kept, and the
 * count of nodes it did not see is kept beside it, so the record says how much was lost rather
 * than only that something was.
 *
 * NOTHING HERE IMPORTS NESTJS. The reflector, the module reference, the controller and the
 * handler arrive as the structural types of `shared/types/nest-surface.ts`, which is what keeps
 * SPEC 23's support for two majors a checkable claim.
 */

/** Everything the registry needs about one node to run the collectors over it. */
export interface CollectorTarget {
  readonly node: IRNode;
  readonly controller: ControllerLike;
  /** The class the handler is written on, which differs from `controller` only when inherited. */
  readonly declaredOn: ControllerLike;
  readonly handler: HandlerLike;
  /** The method name as the prototype holds it, which a wrapper's `name` may not be. */
  readonly handlerName: string;
}

/** What the host supplies once, for the whole pass. */
export interface CollectorRegistryOptions {
  readonly reflector: ReflectorLike;
  readonly moduleRef: ModuleRefLike;
  /**
   * Guards registered for the whole application, read once by the pass, per SPEC 6.2.1.
   *
   * Optional here and never optional in the context: a caller that has no container to ask, which
   * is every unit test of one collector, should not have to write an empty list to say so.
   */
  readonly globalGuards?: readonly string[];
  /** Pipes registered for the whole application, read once by the pass, per SPEC 6.2.1. */
  readonly globalPipes?: readonly string[];
  /** Template for the source link of SPEC 6.3, carried through to the document meta. */
  readonly sourceLinkTemplate?: string;
  /**
   * Guard class to security scheme, per SPEC 13.2, carried through to the document meta.
   *
   * IT IS CARRIED RATHER THAN CONSUMED HERE. No collector reads it; `security-drift` does, and so
   * does anything that re-asks that rule from the served document afterwards. See
   * `IRRuntimeMeta.guardSchemes` for what went wrong while only the pass had it.
   */
  readonly guardSecuritySchemes?: Readonly<Record<string, string>>;
  /** Version of NestJS the host is running, for the document meta. */
  readonly nestVersion?: string;
  /** ISO 8601 instant to record as the collection time. Injected so the meta is reproducible. */
  readonly collectedAt?: string;
}

/** Why a collector is not contributing, and how much it did not see. */
interface Retirement {
  readonly collector: string;
  readonly reason: string;
  /** Nodes the pass reached after it was retired, so the record says how much was lost. */
  missed: number;
}

/** The health check this registry owns, per SPEC 7.2. */
export const COLLECTOR_HEALTH_CHECK_ID = 'runtime-collectors';

export class CollectorRegistry {
  private readonly collectors: readonly IRuntimeCollector[];
  private readonly registeredNames: readonly string[];
  private readonly declined: readonly { readonly collector: string; readonly reason: string }[];
  private readonly retired = new Map<string, Retirement>();
  /**
   * Collectors that returned facts about at least one node, which is what the check counts.
   *
   * A NAME IS ADDED WHEN SOMETHING CAME BACK, not when the collector was called. A collector is
   * called on every node and returns `undefined` on the ones it has nothing to say about, so being
   * called says only that the pass reached it.
   */
  private readonly reported = new Set<string>();
  private readonly options: CollectorRegistryOptions;
  /**
   * The global guard names, frozen once, because every context is handed this same array.
   *
   * FOUND BY SWEEPING FOR F38's SHAPE RATHER THAN BY MEETING IT. The node is frozen because a
   * collector is somebody else's code; this list is the other thing the context hands over that
   * the product reads afterwards, and it is one array shared by every collector on every node.
   * A collector calling `push` or setting `length` on it changes what `guardsCollector` reports
   * for the rest of the application, and every route after that point would name a guard nobody
   * registered. `readonly string[]` says it cannot happen, and one cast in a third party package
   * is all that costs.
   *
   * FROZEN ONCE HERE RATHER THAN PER CONTEXT, because it is one value for the whole pass: a
   * thousand nodes would otherwise pay for a thousand calls that all freeze the same array. The
   * strings inside it need nothing, since a string cannot be edited in place.
   */
  private readonly globalGuards: readonly string[];
  /** The global pipe names, frozen once, for exactly the reasons the guard list is. */
  private readonly globalPipes: readonly string[];

  /**
   * @param registrations - The collectors, in the order they were declared
   * @param options - What the host supplies once for the whole pass
   */
  constructor(registrations: readonly CollectorRegistration[], options: CollectorRegistryOptions) {
    this.options = options;
    this.globalGuards = Object.freeze([...(options.globalGuards ?? [])]);
    this.globalPipes = Object.freeze([...(options.globalPipes ?? [])]);
    this.collectors = registrations.filter(isRuntimeCollector);
    this.declined = registrations
      .filter(isSkippedCollector)
      .map((registration) => ({ collector: registration.name, reason: registration.skipped }));

    // THE NAMES OF EVERY REGISTRATION THAT WAS MEANT TO RUN, including the ones that declined.
    // `IRRuntimeMeta.collectors` answers "what was asked for" and `skipped` answers "and what
    // did not happen", which is the same distinction between "checked and clean" and "there was
    // nothing to check" that this repository draws everywhere else.
    this.registeredNames = registrations
      .filter((registration) => registration !== undefined)
      .map((registration) => registration.name);
  }

  /**
   * Collects every collector's view of one node.
   *
   * @param target - The node and the application objects behind it
   * @returns The merged facts, or undefined when nothing was found
   */
  collect(target: CollectorTarget): IRNodeRuntime | undefined {
    const contributions: Contribution[] = [];

    for (const collector of this.collectors) {
      const retirement = this.retired.get(collector.name);
      if (retirement !== undefined) {
        retirement.missed += 1;
        continue;
      }

      let produced: IRNodeRuntime | undefined;
      try {
        produced = collector.collect(this.contextFor(collector, target));
      } catch (cause) {
        this.retire(collector.name, cause);
        continue;
      }

      if (produced !== undefined) {
        this.reported.add(collector.name);
        contributions.push({ collector: collector.name, runtime: produced });
      }
    }

    return mergeContributions(contributions);
  }

  /**
   * The document wide runtime metadata of SPEC 6.3.
   *
   * @returns What ran, what did not, and why
   */
  meta(): IRRuntimeMeta {
    const skipped = [
      ...this.declined,
      ...[...this.retired.values()].map((retirement) => ({
        collector: retirement.collector,
        reason:
          retirement.missed === 0
            ? retirement.reason
            : `${retirement.reason}. It was retired, so ${String(retirement.missed)} further node(s) were not seen by it`,
      })),
    ];

    return {
      collectors: this.registeredNames,
      ...(this.options.collectedAt === undefined ? {} : { collectedAt: this.options.collectedAt }),
      ...(this.options.nestVersion === undefined ? {} : { nestVersion: this.options.nestVersion }),
      ...(this.options.sourceLinkTemplate === undefined
        ? {}
        : { sourceLinkTemplate: this.options.sourceLinkTemplate }),
      ...(this.options.guardSecuritySchemes === undefined
        ? {}
        : { guardSchemes: this.options.guardSecuritySchemes }),
      ...(skipped.length === 0 ? {} : { skipped }),
    };
  }

  /**
   * The one Documentation Health check this registry answers for.
   *
   * IT IS A CHECK AND NOT A DRIFT ISSUE. Drift is a disagreement between the specification and
   * the running application, per SPEC 7.1, and a collector that threw is neither: it is the
   * instrument failing rather than the two sides differing. Reporting it as drift would put a
   * defect in this package into a list a reader is meant to act on by editing their own code.
   *
   * IT COUNTS WHAT CAME BACK, NOT WHAT WAS TYPED. Until this it counted registrations minus the
   * ones that declined or threw, so on every run where nothing crashed it read `5 / 5`, and it is
   * the only line about collectors a reader of the health page sees. A registration is the host's
   * own input, so a check whose numerator and denominator both come from it answers a question
   * nobody asked. A collector that was reached on every node and never once had anything to say is
   * the ordinary shape of a misconfiguration, a metadata key that does not match or a package the
   * application does not actually use, and it was invisible. It is a `warning` because the other
   * reading is also possible and also fine: an application with no streaming endpoint gives
   * `streamCollector` nothing to report, and that is worth a reader's glance rather than an alarm.
   *
   * @returns How many of the registered collectors reported a fact about at least one node
   */
  healthCheck(): IRHealthCheck {
    return {
      id: COLLECTOR_HEALTH_CHECK_ID,
      label: 'Runtime collectors that reported a fact',
      passed: this.registeredNames.filter((name) => this.reported.has(name)).length,
      total: this.registeredNames.length,
      severity: 'warning',
    };
  }

  /**
   * Builds the context one collector sees.
   *
   * @param collector - The collector about to run
   * @param target - The node it is about to see
   * @returns Its context, with `fact` already bound to its name
   */
  private contextFor(collector: IRuntimeCollector, target: CollectorTarget): CollectorContext {
    return {
      // FROZEN, BECAUSE `readonly` IS A COMPILE TIME OPINION AND A COLLECTOR IS SOMEBODY ELSE'S
      // CODE. Found in T025 by writing one that assigns to `context.node.id`: it compiles in a
      // third party package behind one cast, and the pass keys facts by that id, hashes the
      // document and serves it, so the edit reaches every reader with nothing anywhere saying a
      // collector did it. This is the same argument that makes the registry restamp `collector`
      // on every fact rather than trust the type.
      //
      // SHALLOW, AND THAT IS THE PROPORTION RATHER THAN AN OVERSIGHT. It closes assignment to the
      // node's own fields, which is what a collector reaches for and what the pass reads; a deep
      // freeze of every parameter, response and schema of every node would put a walk of the whole
      // document into the boot to defend against a collector editing a nested array in place.
      // In an ES module a write to a frozen field throws, so the registry retires that collector
      // with the reason, which is the fail-open behaviour SPEC 6.2 already asks for.
      node: Object.freeze(target.node),
      controller: target.controller,
      declaredOn: target.declaredOn,
      handler: target.handler,
      handlerName: target.handlerName,
      reflector: this.options.reflector,
      moduleRef: this.options.moduleRef,
      // FROZEN, AND A COPY OF WHAT THE HOST HANDED OVER. See the field: it is one array every
      // collector on every node is given, so an edit to it is an edit to the rest of the pass.
      globalGuards: this.globalGuards,
      globalPipes: this.globalPipes,
      fact: <T>(value: T, confidence: IRConfidence): IRFact<T> => ({
        value,
        confidence,
        collector: collector.name,
      }),
    };
  }

  /**
   * Retires a collector that threw, keeping the reason.
   *
   * @param collector - Its name
   * @param cause - Whatever it threw, which is not necessarily an Error
   */
  private retire(collector: string, cause: unknown): void {
    const reason = cause instanceof Error ? cause.message : String(cause);

    this.retired.set(collector, {
      collector,
      reason: `it threw while collecting: ${reason}`,
      missed: 0,
    });
  }
}
