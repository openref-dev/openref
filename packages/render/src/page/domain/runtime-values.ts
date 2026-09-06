/**
 * The value vocabulary the runtime block and the parity scale share.
 *
 * Two builders draw runtime facts, `runtime-model.ts` for the labelled rows and the Health
 * panel, `parity-model.ts` for the scale of SPEC 6.3, and both speak in `RuntimeValueModel`.
 * The helpers live here so the two cannot drift apart, and so neither imports the other, which
 * would be a cycle: the runtime model wires the parity rows in, and the parity builder reads
 * these same formatters.
 */

import type {
  IRConfidence,
  IRDriftSeverity,
  IRGuard,
  IRGuardScope,
  IRHandlerPolicy,
  IRHandlerPolicyKind,
  IRHandlerPolicySetting,
  IRParameterReads,
  IRPipe,
  IRPipeScope,
  IRRateLimit,
  IRRateLimitReach,
  IRStreaming,
  IRTimeout,
} from '@openref/core';
import type { RuntimeValueModel } from '@openref/vue';

/** Which drift token group a severity paints from. `crit`, `warn` and `note` are the design's. */
export const SEVERITY_CLASSES: Readonly<Record<IRDriftSeverity, string>> = {
  error: 'oref-drift-crit',
  warning: 'oref-drift-warn',
  info: 'oref-drift-note',
};

/** Windows a rate limit is most often written in, so the row reads as a sentence. */
const WINDOWS: readonly (readonly [number, string])[] = [
  [1000, 'second'],
  [60_000, 'minute'],
  [3_600_000, 'hour'],
  [86_400_000, 'day'],
];

/** A value with nothing but text on it, which is most of them. */
export const EMPTY_VALUE = {
  status: '',
  statusClass: '',
  text: '',
  href: '',
  note: '',
  confidence: null,
  collector: '',
} as const satisfies RuntimeValueModel;

/**
 * The provenance of a value, as the two facts and not as the three strings drawn from them.
 *
 * THE CODE, THE CLASS AND THE TOOLTIP MOVED INTO THE COMPONENT IN `TX-SLOTWIRE`, and the reason
 * is the `ProvenanceTag` slot: its props are `confidence` and `collector`, so a value carrying
 * `DCL`, `oref-prov oref-prov-declared` and `declared, guardsCollector` could not supply them
 * without the position parsing back what this had already formatted. The page pays less for it
 * too, which was not the reason and is measurable: three strings per value became two shorter
 * ones in every node page's state block.
 *
 * @param confidence - Level of the fact
 * @param collector - Name of the collector that produced it
 * @returns The two fields a provenance mark is drawn from
 */
export function mark(
  confidence: IRConfidence,
  collector: string,
): Pick<RuntimeValueModel, 'confidence' | 'collector'> {
  return { confidence, collector };
}

/**
 * A rate limit in the words a reader would use.
 *
 * @param limit - The limit as the throttler declares it
 * @returns `100 / minute`, or `100 / 30 s` for a window with no name
 */
export function rateLimitLabel(limit: IRRateLimit): string {
  const named = WINDOWS.find(([ms]) => ms === limit.ttlMs)?.[1];
  const window = named ?? `${String(limit.ttlMs / 1000)} s`;
  const suffix = limit.name === undefined || limit.name === '' ? '' : ` (${limit.name})`;

  return `${String(limit.limit)} / ${window}${suffix}`;
}

/**
 * What a route with no limit of its own is told, in the two lines a cell draws.
 *
 * THE WORDS ARE BUILT ONCE HERE AND BY NO COLLECTOR, which is what makes {@link IRRateLimitReach}
 * a generalisation rather than one library's special case. `@nestjs/throttler` behind a global
 * guard and `@nestjs-redisx/rate-limit` behind one report the same shape and read the same on the
 * page; a collector supplies only what it observed, the names and, where it read one, the budget.
 *
 * THE SECOND LINE REFUSES THE ATTRIBUTION IN THE SAME BREATH AS IT GIVES THE NUMBER, per SPEC 6.1
 * and 6.2.3. A budget printed on its own reads as this route's limit, which is precisely what
 * nothing observed, so the sentence that names the figure is the sentence that says whose it is
 * not. Where nothing states a figure the line says that instead, because "no budget anywhere" and
 * "a budget that is not this route's" are two different things a reader acts on differently.
 *
 * @param reach - The fact's value
 * @returns The value line and the note line
 */
export function rateLimitReachLabel(reach: IRRateLimitReach): { value: string; note: string } {
  if (reach.kind === 'none') {
    return {
      value: 'Not rate limited',
      note: 'This route declares no limit and nothing stands in front of the whole application.',
    };
  }

  const where = reach.budgetSource === undefined ? '' : `, read from ${reach.budgetSource}`;
  const budget =
    reach.budget === undefined
      ? 'Nothing states a budget anywhere.'
      : `The module budget is ${rateLimitLabel(reach.budget)}${where}.`;

  return {
    value: `No limit of its own; governed from outside by ${reach.by.join(', ')}`,
    note:
      `${budget} Whether this route is exempt, and at what budget, is decided inside guard ` +
      'code, which is never read.',
  };
}

/**
 * A streaming fact in one line.
 *
 * THE ITEM SCHEMA IS NAMED AS PRESENT OR ABSENT AND NEVER GUESSED, per SPEC 13.6. A stream with
 * no declared item type is the subject of the `stream-unspecified` rule, and printing a shape
 * here would be the guess that rule exists to report.
 *
 * @param streaming - The streaming fact
 * @returns `SSE`, with the heartbeat when one was declared
 */
export function streamingLabel(streaming: IRStreaming): string {
  const transport = streaming.transport === 'sse' ? 'SSE' : streaming.transport;
  const beat =
    streaming.heartbeatMs === undefined
      ? ''
      : `, heartbeat ${String(streaming.heartbeatMs / 1000)} s`;

  return `${transport}${beat}`;
}

/**
 * A timeout in the words a reader would use.
 *
 * @param timeout - The timeout fact's value
 * @returns `5000 ms`
 */
export function timeoutLabel(timeout: IRTimeout): string {
  return `${String(timeout.ms)} ms`;
}

/**
 * The scope note of a pipe value, in the vocabulary the guard rows already taught.
 *
 * The route's own pipes carry no note, the way the route's own guard row is called `Guards`
 * unqualified: the qualified rows are the ones that need the qualification.
 */
const PIPE_SCOPE_NOTES: Readonly<Record<IRPipeScope, string>> = {
  route: '',
  parameter: 'parameter level',
  global: 'application wide',
};

/**
 * Pipes as values, one per scope and provenance, nearest decision first.
 *
 * The same merge as {@link guardValues}: three pipes one collector read at one scope are one
 * observation of three names, and the scope travels in the note because a reader deciding
 * whether input is validated needs to know which decision they are looking at, per SPEC 6.2.1.
 *
 * @param pipes - Pipes observed on the route, at every scope
 * @returns One value per distinct scope and provenance, route, then parameter, then global
 */
export function pipeValues(pipes: readonly IRPipe[]): RuntimeValueModel[] {
  const values: RuntimeValueModel[] = [];

  for (const scope of ['route', 'parameter', 'global'] as const) {
    for (const pipe of pipes) {
      if (pipe.scope !== scope) continue;

      const note = PIPE_SCOPE_NOTES[scope];
      const at = values.findIndex(
        (value) =>
          value.note === note &&
          value.confidence === pipe.confidence &&
          value.collector === pipe.collector,
      );

      if (at === -1) {
        values.push({
          ...EMPTY_VALUE,
          text: pipe.name,
          note,
          ...mark(pipe.confidence, pipe.collector),
        });
        continue;
      }

      const held = values[at];
      if (held !== undefined) values[at] = { ...held, text: `${held.text}, ${pipe.name}` };
    }
  }

  return values;
}

/**
 * The handler scan's verdicts as one value: the count, and the names behind it.
 *
 * THE THREE VERDICTS STAY APART IN THE WORDS, per SPEC 6.2.1: `not seen read` is a statement
 * about the handler and is named per parameter, `not accounted for` is a statement about the
 * scan and is counted, and folding either into the other would put the scan's blindness on the
 * application or the application's dead weight on the scan.
 *
 * @param reads - The fact's value
 * @returns The value line and the note line
 */
export function parameterReadsLabel(reads: IRParameterReads): { value: string; note: string } {
  const total = reads.parameters.length;
  const read = reads.parameters.filter((parameter) => parameter.verdict === 'read').length;
  const notSeen = reads.parameters.filter((parameter) => parameter.verdict === 'not-seen-read');
  const unaccounted = reads.parameters.filter(
    (parameter) => parameter.verdict === 'unaccounted',
  ).length;

  const notes: string[] = [];
  if (notSeen.length > 0) {
    notes.push(`not seen read: ${notSeen.map((parameter) => parameter.name).join(', ')}`);
  }
  if (unaccounted > 0) notes.push(`${String(unaccounted)} not accounted for by the scan`);

  return {
    value: `${String(read)} of ${String(total)} seen read`,
    note: notes.join('; '),
  };
}

/**
 * What each policy kind is called on the page, in a reader's words rather than a library's.
 *
 * NAMED FOR THE BEHAVIOUR AND NOT FOR THE DECORATOR, because a second library that caches the same
 * way produces the same kind and must read the same. The decorator's own name reaches the reader
 * where it matters, in the `declaredBy` setting an unbound declaration carries.
 */
const POLICY_LABELS: Readonly<Record<IRHandlerPolicyKind, string>> = {
  cache: 'Cached',
  lock: 'Locked',
  'circuit-breaker': 'Circuit breaker',
};

/**
 * One setting as `name value`, with a list joined rather than printed as an array.
 *
 * @param setting - The declared setting
 * @returns `ttlMs 60000`, `tags orders, users`
 */
function settingText(setting: IRHandlerPolicySetting): string {
  const value = Array.isArray(setting.value) ? setting.value.join(', ') : String(setting.value);

  return `${setting.name} ${value}`;
}

/**
 * Handler policies as values, one per policy, in the order the collectors reported them.
 *
 * NOT MERGED BY PROVENANCE, WHICH IS WHERE THIS PARTS COMPANY WITH {@link guardValues}. Three
 * guards from one collector are three names for one observation and read as noise apart; a cache
 * and a lock from two collectors are two different behaviours with two different sets of numbers,
 * and joining their texts would produce a line no reader could parse.
 *
 * THE UNBOUND ONES SAY SO ON THE ROW AND NOT ONLY IN THE REPORT, per {@link IRHandlerPolicyReach}.
 * A ttl beside a declaration nothing binds is the exact defect this member exists to prevent, so
 * the note is written before anything else in the line and the collector reports no settings for
 * that case at all.
 *
 * @param policies - What the collectors attached to the node
 * @returns One value per policy, empty when there are none
 */
export function handlerPolicyValues(policies: readonly IRHandlerPolicy[]): RuntimeValueModel[] {
  return policies.map((policy) => {
    const scope = policy.key === undefined || policy.key === '' ? '' : ` on ${policy.key}`;
    const settings = policy.settings.map(settingText).join(', ');
    const unbound =
      policy.reach === 'unbound'
        ? 'Declared and bound by nothing here, so this route does not behave this way today. '
        : '';

    return {
      ...EMPTY_VALUE,
      text: `${POLICY_LABELS[policy.kind]}${scope}`,
      note: `${unbound}${settings}`,
      ...mark(policy.confidence, policy.collector),
    };
  });
}

/**
 * Guards at one scope, as one value per provenance rather than one per guard.
 *
 * Three guards read by one collector are one observation of three names, and three marks saying
 * the same thing about where they came from is noise. Two collectors reporting guards at
 * different confidence are two observations, and those stay apart.
 *
 * @param guards - Guards observed on the route, at every scope
 * @param scope - The scope this row draws
 * @returns One value per distinct provenance, in the order the guards were merged
 */
export function guardValues(guards: readonly IRGuard[], scope: IRGuardScope): RuntimeValueModel[] {
  const values: RuntimeValueModel[] = [];

  for (const guard of guards) {
    if (guard.scope !== scope) continue;

    const at = values.findIndex(
      (value) => value.confidence === guard.confidence && value.collector === guard.collector,
    );

    if (at === -1) {
      values.push({ ...EMPTY_VALUE, text: guard.name, ...mark(guard.confidence, guard.collector) });
      continue;
    }

    const held = values[at];
    if (held !== undefined) values[at] = { ...held, text: `${held.text}, ${guard.name}` };
  }

  return values;
}
