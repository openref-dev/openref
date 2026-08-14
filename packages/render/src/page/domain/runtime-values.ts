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
  IRRateLimit,
  IRStreaming,
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
