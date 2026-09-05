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
import { mergeContributions, type Contribution, type FactContest } from '../../domain/merge';
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

/** One pair of collectors that tied over one field, and every route where they did. */
interface ContestRecord {
  readonly contest: FactContest;
  /** The first route it happened on, which is the one a reader is sent to look at. */
  readonly firstSubject: string;
  /** How many routes in all, so the record says how wide the disagreement is. */
  routes: number;
}

/** The health check this registry owns, per SPEC 7.2. */
export const COLLECTOR_HEALTH_CHECK_ID = 'runtime-collectors';

/**
 * Reads one entry of a collector's problem list, when it is one.
 *
 * A THIRD PARTY COLLECTOR'S LIST IS NOT TYPE CHECKED BY ANYTHING. `problems()` is not on the frozen
 * contract, so nothing between that collector and this line agreed on what it holds, and a document
 * carrying `[object Object]` in a `doctor` report would be this package's defect and not theirs.
 *
 * @param entry - One element of whatever `problems()` returned
 * @returns The problem, or undefined when the element is not one
 */
function asProblem(entry: unknown): { subject: string; reason: string } | undefined {
  if (typeof entry !== 'object' || entry === null) return undefined;

  const { subject, reason } = entry as { subject?: unknown; reason?: unknown };
  if (typeof subject !== 'string' || typeof reason !== 'string') return undefined;
  if (subject === '' || reason === '') return undefined;

  return { subject, reason };
}

export class CollectorRegistry {
  private readonly collectors: readonly IRuntimeCollector[];
  private readonly registeredNames: readonly string[];
  private readonly declined: readonly { readonly collector: string; readonly reason: string }[];
  private readonly retired = new Map<string, Retirement>();
  /**
   * Ties of equal confidence, one record per pair of collectors and field rather than per route.
   *
   * KEYED SO THE REPORT IS READABLE, by the same doctrine that retires a throwing collector after
   * one record: two collectors that tie over `rateLimit` on one route tie over it on every route
   * they both see, and a thousand copies of one sentence is a report nobody reads. The count of
   * routes rides along, so the record says how wide the disagreement is rather than only that
   * there was one.
   */
  private readonly contested = new Map<string, ContestRecord>();
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

    const contests: FactContest[] = [];
    const merged = mergeContributions(contributions, contests);
    this.recordContests(contests, `${target.controller.name}.${target.handlerName}`);

    return merged;
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
   * Everything the collectors could not read, and everything this pass decided for them.
   *
   * TWO SOURCES AND ONE CHANNEL, because a reader of `doctor` has one question and it is not "which
   * layer noticed". The first is the collectors' own record of what they met and could not turn
   * into a fact; the second is {@link contests}, this registry's record of a tie it broke.
   *
   * WHY THE COLLECTORS' RECORD HAD TO BE DRAINED HERE. CLAUDE.md's rule is that a fact which cannot
   * be obtained produces a `doctor` warning and never a guess, and every collector in this
   * repository and in all four ecosystem packages honours the first half by keeping a `problems()`
   * list. Nothing read it. Measured before this change: `grep -rn '\\.problems()'` outside `test/`
   * returned zero hits, so fifteen collectors were writing warnings into an accumulator whose only
   * reader was their own unit tests, and a third party collector had no route into `doctor` at all.
   * A rule with no runner is the shape SPEC 0 is written against.
   *
   * IT IS READ STRUCTURALLY AND `IRuntimeCollector` DOES NOT MOVE. The contract is two members and
   * frozen as public API, so `problems()` cannot become a third one without a major version; what
   * this does is offer a channel to a collector that already has the method, which every one of
   * ours does and any third party may. A collector without it is not asked and loses nothing.
   *
   * IT IS FAIL OPEN LIKE EVERYTHING ELSE HERE. `problems()` is somebody else's code running after
   * the pass: a throw is caught and reported as its own problem rather than taking the boot down,
   * and an entry that is not a pair of strings is skipped rather than printed as `[object Object]`.
   *
   * @returns One entry per problem, named by the collector that reported it
   */
  problems(): readonly { readonly subject: string; readonly reason: string }[] {
    return [...this.collectorProblems(), ...this.contests()];
  }

  /**
   * Drains the problem list of every collector that keeps one.
   *
   * @returns What the collectors could not read, prefixed with the name that could not read it
   */
  private collectorProblems(): readonly { readonly subject: string; readonly reason: string }[] {
    const drained: { subject: string; reason: string }[] = [];

    for (const collector of this.collectors) {
      const method = (collector as { problems?: unknown }).problems;
      if (typeof method !== 'function') continue;

      let found: unknown;
      try {
        found = (method as () => unknown).call(collector);
      } catch (cause) {
        drained.push({
          subject: collector.name,
          reason:
            'it threw when asked for the problems it recorded: ' +
            `${cause instanceof Error ? cause.message : String(cause)}. Whatever it could not ` +
            'read is therefore unreported, which is a defect in the collector rather than in the ' +
            'application',
        });
        continue;
      }

      if (!Array.isArray(found)) continue;

      for (const entry of found as readonly unknown[]) {
        const problem = asProblem(entry);
        if (problem === undefined) continue;

        // THE COLLECTOR'S NAME GOES IN FRONT, as it does for a skipped one. Every reason in this
        // repository is written as a continuation of its subject, so without the name a reader of
        // `doctor` is told a route has an unreadable policy and not by which instrument.
        drained.push({
          subject: problem.subject,
          reason: `${collector.name}: ${problem.reason}`,
        });
      }
    }

    return drained;
  }

  /**
   * The ties of equal confidence this pass resolved by registration order, phrased for `doctor`.
   *
   * A TIE IS DETERMINISTIC AND WAS INVISIBLE, WHICH IS TWO PROPERTIES AND NOT ONE. SPEC 6.2 states
   * the rule and T017 has always enforced it, so the same input has always produced the same
   * document; what nothing said was that a second collector had reported a different value for a
   * fact a reader is looking at. The page draws the winner's provenance, so the reader could not
   * tell one report from two. It stayed unreachable while every fact field had a single producer in
   * the shipped set, and the second producer of `rateLimit` reaches it.
   *
   * IT IS A PROBLEM AND NOT A DRIFT ISSUE, by the argument {@link healthCheck} already makes about
   * the other direction: drift is the specification and the application disagreeing, per SPEC 7.1,
   * and this is two instruments disagreeing. `IRRuntimeMeta.problems` is where a fact the reference
   * would have carried and cannot goes, and the dropped value is exactly that.
   *
   * @returns One entry per pair of collectors and field, in the order the ties first happened
   */
  contests(): readonly { readonly subject: string; readonly reason: string }[] {
    return [...this.contested.values()].map((record) => ({
      subject: record.firstSubject,
      reason:
        `two collectors reported ${record.contest.field} at "${record.contest.confidence}", and ` +
        `equal confidence is broken by registration order, so ${record.contest.kept} is in the ` +
        `reference and ${record.contest.dropped} was dropped${
          record.routes === 1 ? '' : ` on this and ${String(record.routes - 1)} further route(s)`
        }. Register only the collector that reads the mechanism this application actually runs, or ` +
        'put it first, because the first registration wins',
    }));
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
   * Folds one node's ties into the pass wide record.
   *
   * @param contests - What the merge decided by order on this node
   * @param subject - The route, as a reader of `doctor` recognises it
   */
  private recordContests(contests: readonly FactContest[], subject: string): void {
    for (const contest of contests) {
      const key = `${contest.field}\0${contest.kept}\0${contest.dropped}\0${contest.confidence}`;
      const held = this.contested.get(key);

      if (held === undefined) {
        this.contested.set(key, { contest, firstSubject: subject, routes: 1 });
        continue;
      }

      held.routes += 1;
    }
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
