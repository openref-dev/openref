/**
 * The parity scale of one operation, per SPEC 6.3 and `TX-GUTTER`: eleven rows, each pairing
 * what the specification declares with what the application does, a verdict in the gutter
 * between them, and the FixBar under a drifted row.
 *
 * THE VERDICT IS THE ENGINE'S OUTCOME AND NEVER A GUESS. `match` only where the row's SPEC 7.1
 * rule examined this operation and stayed quiet, which is read by re-asking the rule itself
 * through `operationRuleOutcome`, so no second copy of a scope predicate exists to drift.
 * `drift` only where a finding is recorded in the report. `unknown` everywhere a comparison did
 * not run: no fact, no rule for the row yet, or a document nothing measured. A document with no
 * health report answers `unknown` on every row rather than borrowing verdicts from a run that
 * never happened.
 *
 * AN EMPTY CELL SAYS WHICH OF THE TWO SILENCES IT IS, since `TX-INSTRUMENT`. `Nothing observed
 * here.` was one sentence over two facts the IR keeps apart: a collector for this fact is not
 * registered at all, and a collector that is registered examined this route and found nothing. The
 * first is a gap in the installation and the second is the answer, and a reader could act on
 * neither while both read the same. The registry the document already carries decides which,
 * through `runtimeInstrument`, and the hatched treatment stays either way.
 *
 * A ROW CARRYING FACTS UNDER `?` SAYS SO TOO, and that half had no words at all. Two rows draw
 * their facts under a `?` verdict, validation and timeout,
 * because no rule examines them yet, which is the roles precedent; and the response codes row
 * answers to two rules at once, `error-undocumented` and `status-drift`, drawing `=` only when
 * at least one examined and stayed quiet and none found anything.
 *
 * EVERYTHING HERE IS DECIDED ON THE SERVER, once per document hash, like the rest of the page
 * model: the limit is already in words, the source link is already expanded, the code is
 * already looked up. A branch not taken here is a branch that is not in the bundle every
 * reader downloads.
 */

import {
  DRIFT_RULE_CODES,
  expandSourceLink,
  observedFactCollectors,
  operationRuleOutcome,
  runtimeInstrument,
  type DriftObservation,
  type IRDocument,
  type IRDriftIssue,
  type IRDriftRule,
  type IRErrorContract,
  type IROperation,
  type RuntimeFactField,
  type RuntimeInstrument,
} from '@openref/core';
import type {
  ParityFixModel,
  ParityRowKind,
  ParityRowModel,
  ParitySideModel,
  ParityVerdict,
  RuntimeValueModel,
} from '@openref/vue';
import { healthPageHref } from './links';
import {
  EMPTY_VALUE,
  guardValues,
  mark,
  parameterReadsLabel,
  pipeValues,
  rateLimitLabel,
  SEVERITY_CLASSES,
  streamingLabel,
  timeoutLabel,
} from './runtime-values';

/** What the specification says when it says nothing, which the design prints rather than hides. */
const NOT_DESCRIBED = 'not described';

/**
 * The subject of each row: which fact of `IRNodeRuntime` fills it, and its name in the reader's
 * words, singular and pluralized with an `s`.
 *
 * A `Record` OVER EVERY ROW, so a row added to the scale cannot reach a reader with an empty cell
 * that says nothing about why it is empty. That was the state of all eleven of them until this
 * table: one sentence, `Nothing observed here.`, printed by twelve code sites over two facts the
 * IR itself keeps apart, per `IRErrorContracts` and `IRRuntimeMeta.skipped`.
 */
const ROW_SUBJECT: Readonly<Record<ParityRowKind, readonly [RuntimeFactField, string]>> = {
  authentication: ['guards', 'guard'],
  scopes: ['scopes', 'scope'],
  roles: ['roles', 'role'],
  'rate-limit': ['rateLimit', 'rate limit'],
  'response-codes': ['errors', 'error contract'],
  'required-headers': ['requiredHeaders', 'required header'],
  validation: ['pipes', 'pipe'],
  timeout: ['timeout', 'timeout'],
  streaming: ['streaming', 'stream'],
  'unread-parameters': ['parameterReads', 'parameter read'],
  source: ['source', 'source location'],
};

/**
 * Why a row is empty, or why it carries no verdict, in the words the `source` row set.
 *
 * FOUR SENTENCES WHERE THERE WAS ONE, and the difference between the first two is the whole point:
 * `absent` is a statement about this installation, which the reader fixes by registering something,
 * and `ran` is a statement about this route, which is already correct and needs nothing. One phrase
 * over both told a reader with no rate limit collector the same thing it told a reader whose route
 * simply has no limit, and neither could act on it.
 *
 * NAMING A COLLECTOR IS A SUGGESTION AND NOT A DIAGNOSIS. `RUNTIME_FACT_COLLECTORS` holds only what
 * this distribution ships, so the sentence offers that name and says in the same breath that a
 * collector of the host's own would do, because a host whose limiter is not `@nestjs/throttler`
 * must not read "add throttlerCollector" as the only answer.
 *
 * AND `ran` NO LONGER SAYS "THE ROUTE IS SILENT", BECAUSE THAT WAS AN ASSERTION THE COLLECTOR NEVER
 * MADE. It said what a collector observed and then drew a conclusion the observation does not carry:
 * a collector reads declarations on a route, and a route can be governed by something that is not a
 * declaration on it. The case that found it is an application whose rate limiting guard is
 * registered for the whole application and whose routes mostly carry no decorator, where fifty four
 * of fifty eight operations were told a limit does not apply when one does. What a collector can
 * report is what it read, so that is what the sentence now says, and it points at the report that
 * holds whatever the route is governed by from outside itself.
 *
 * @param instrument - What `runtimeInstrument` decided about this fact
 * @param noun - The row's subject, singular
 * @returns The sentence a reader sees in the hatched cell
 */
function instrumentReason(instrument: RuntimeInstrument, noun: string): string {
  switch (instrument.kind) {
    case 'unmeasured':
      return `No runtime pass ran on this document, so nothing asked about ${noun}s.`;
    case 'ran': {
      const who = instrument.collector === '' ? 'A collector' : instrument.collector;

      return (
        `${who} examined this route and found no ${noun} declared on it. Anything applied to it ` +
        'from outside the route is named in the doctor report, not here.'
      );
    }
    case 'skipped':
      return `${instrument.collector} was registered and did not run: ${instrument.reason}`;
    case 'absent':
      return (
        `No registered collector reports ${noun}s. Add ${instrument.shipped.join(' or ')} to the ` +
        'collectors option, or write one that does.'
      );
  }
}

/**
 * Why a row carrying facts still shows no verdict, which is the other half of the same question.
 *
 * THE GUTTER HAD ONE READER AND IT WAS A SCREEN READER. `?` carried `comparison not run` in an
 * `aria-label` and nothing else, so a sighted reader saw a question mark with no way to ask what it
 * meant. The sentence is the same one either way now, and the component hangs it on the glyph.
 */
const NO_RULE_YET =
  'No rule of the drift catalogue examines this row yet, so neither side is judged.';

/**
 * The rules that give each row its verdict, for the rows that have any today.
 *
 * A LIST PER ROW SINCE `TX-COLLECTORS`, because the response codes row answers two questions
 * with one pair of cells: the documented codes against the declared errors, and against the
 * explicit success code. The rows with no list, roles, validation, timeout and source, draw
 * their facts under `?` until a rule exists to examine them.
 */
const ROW_RULES: Partial<Record<ParityRowKind, readonly IRDriftRule[]>> = {
  authentication: ['security-drift'],
  scopes: ['scope-drift'],
  'rate-limit': ['ratelimit-undocumented'],
  'response-codes': ['error-undocumented', 'status-drift'],
  'required-headers': ['header-requiredness-drift'],
  streaming: ['stream-unspecified'],
  'unread-parameters': ['parameter-unread'],
};

/** The eleven rows, in the order the design draws them. */
const ROW_ORDER: readonly (readonly [ParityRowKind, string])[] = [
  ['authentication', 'Authentication'],
  ['scopes', 'Scopes'],
  ['roles', 'Roles'],
  ['rate-limit', 'Rate limit'],
  ['response-codes', 'Response codes'],
  ['required-headers', 'Required headers'],
  ['validation', 'Validation'],
  ['timeout', 'Timeout'],
  ['streaming', 'Streaming'],
  ['unread-parameters', 'Unread parameters'],
  ['source', 'Source'],
];

/** A side with a value and an optional second line. */
function side(value: string, note = ''): ParitySideModel {
  return { value, note };
}

/**
 * A count and its noun, agreeing.
 *
 * Every one of these nouns pluralizes with an `s`, so the rule is the rule and not a table. It
 * exists because two rows printed `1 codes declared` and `1 parameters declared` on every operation
 * that declares exactly one of either, which on a real document is most of them.
 *
 * @param count - How many
 * @param noun - The singular
 * @returns `1 code`, `2 codes`
 */
function plural(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? '' : 's'}`;
}

/** Every status code the operation documents, as written and in document order. */
function documentedStatuses(operation: IROperation): readonly string[] {
  return operation.responses.map((response) => response.statusCode);
}

/**
 * Error contracts of one group, as one value per distinct provenance.
 *
 * The merge is the guard rule again: three contracts one collector derived are one observation
 * of three codes, two collectors are two observations. The provenance survives the merge, per
 * the confidence rule, and the group's own name travels in the note so a reader can tell a
 * promise from an observation inside one cell.
 *
 * @param contracts - The group's contracts
 * @param note - The group's name, in the reader's words
 * @returns The merged values
 */
function contractValues(contracts: readonly IRErrorContract[], note: string): RuntimeValueModel[] {
  const values: RuntimeValueModel[] = [];

  for (const contract of contracts) {
    const at = values.findIndex(
      (value) => value.confidence === contract.confidence && value.collector === contract.collector,
    );

    if (at === -1) {
      values.push({
        ...EMPTY_VALUE,
        text: String(contract.status),
        note,
        ...mark(contract.confidence, contract.collector),
      });
      continue;
    }

    const held = values[at];
    if (held !== undefined)
      values[at] = { ...held, text: `${held.text}, ${String(contract.status)}` };
  }

  return values;
}

/** The specification half of each row, read from the document alone. */
function specSide(kind: ParityRowKind, operation: IROperation): ParitySideModel {
  switch (kind) {
    case 'authentication': {
      const ids = operation.security.map((requirement) => requirement.schemeId);
      return ids.length === 0 ? side(NOT_DESCRIBED) : side(`security: ${ids.join(', ')}`);
    }
    case 'scopes': {
      const scopes = [...new Set(operation.security.flatMap((requirement) => requirement.scopes))];
      if (scopes.length === 0) return side(NOT_DESCRIBED);
      return side(scopes.join(', '), `${String(scopes.length)} in the specification`);
    }
    case 'roles':
      return side(NOT_DESCRIBED, 'OpenAPI has no field for roles');
    case 'rate-limit': {
      const has429 = documentedStatuses(operation).includes('429');
      return has429 ? side('429 documented') : side(NOT_DESCRIBED, 'no 429 response');
    }
    case 'response-codes': {
      const statuses = documentedStatuses(operation);
      if (statuses.length === 0) return side(NOT_DESCRIBED);
      return side(statuses.join(' '), `${plural(statuses.length, 'code')} declared`);
    }
    case 'required-headers': {
      const headers = operation.parameters.filter((parameter) => parameter.in === 'header');
      if (headers.length === 0) return side(NOT_DESCRIBED, 'no header parameters');
      return side(
        headers
          .map((parameter) => `${parameter.name}: ${parameter.required ? 'required' : 'optional'}`)
          .join(', '),
      );
    }
    case 'validation': {
      const media = operation.requestBody?.content[0];
      if (media?.schema === undefined) return side(NOT_DESCRIBED, 'no request body schema');
      const name = media.schema.kind === 'named' ? media.schema.schemaId : 'inline schema';
      return side(`schema: ${name}`, media.mediaType);
    }
    case 'timeout': {
      const has504 = documentedStatuses(operation).includes('504');
      return has504 ? side('504 documented') : side(NOT_DESCRIBED, 'no 504 response');
    }
    case 'streaming': {
      const streams = operation.responses.some(
        (response) =>
          response.itemSchema !== undefined ||
          response.content.some((media) => media.mediaType === 'text/event-stream'),
      );
      return streams ? side('text/event-stream') : side(NOT_DESCRIBED);
    }
    case 'unread-parameters': {
      const count = operation.parameters.length;
      if (count === 0) return side('no parameters declared');
      return side(`${plural(count, 'parameter')} declared`);
    }
    case 'source':
      return side(NOT_DESCRIBED, 'the specification does not reference code');
  }
}

/**
 * The runtime half of each row, read from the facts the collectors attached.
 *
 * @param kind - The row
 * @param operation - The operation, whose `runtime` the caller has checked exists
 * @param template - `IRRuntimeMeta.sourceLinkTemplate`, with `{ref}` already substituted
 * @returns The values, empty when nothing was observed for this row
 */
function runtimeSide(
  kind: ParityRowKind,
  operation: IROperation,
  template: string | undefined,
): readonly RuntimeValueModel[] {
  const runtime = operation.runtime;
  if (runtime === undefined) return [];

  switch (kind) {
    case 'authentication': {
      const guards = runtime.guards ?? [];
      return [
        ...guardValues(guards, 'route'),
        ...guardValues(guards, 'global').map((value) => ({
          ...value,
          note: 'application wide',
        })),
      ];
    }
    case 'scopes': {
      const scopes = runtime.scopes;
      if (scopes === undefined) return [];
      return [
        {
          ...EMPTY_VALUE,
          text: scopes.value.join(', '),
          ...mark(scopes.confidence, scopes.collector),
        },
      ];
    }
    case 'roles': {
      const roles = runtime.roles;
      if (roles === undefined) return [];
      return [
        {
          ...EMPTY_VALUE,
          text: roles.value.join(', '),
          ...mark(roles.confidence, roles.collector),
        },
      ];
    }
    case 'rate-limit': {
      const limit = runtime.rateLimit;
      if (limit === undefined) return [];
      return [
        {
          ...EMPTY_VALUE,
          text: rateLimitLabel(limit.value),
          ...mark(limit.confidence, limit.collector),
        },
      ];
    }
    case 'response-codes': {
      const errors = runtime.errors;
      const status = runtime.statusCode;
      if (errors === undefined && status === undefined) return [];
      // THE EXPLICIT SUCCESS CODE COMES FIRST, because the success story precedes the error
      // story in every list of codes the document itself draws. It is a value beside the error
      // groups rather than a row of its own: which code success answers with is a fact about
      // the operation's response codes, which is what this row is about.
      const success =
        status === undefined
          ? []
          : [
              {
                ...EMPTY_VALUE,
                text: `success ${String(status.value)}`,
                note: 'explicit @HttpCode',
                ...mark(status.confidence, status.collector),
              },
            ];
      if (errors === undefined) return success;
      // ONLY `declared` SURVIVES BEING EMPTY, per SPEC 6.4: it is the group a person writes, so
      // an empty one asserts that the route was read and nobody wrote anything on it, and the
      // cell keeps the sentence the labelled rows carried. The other two groups assert nothing
      // by being empty and draw nothing.
      const declared =
        errors.declared.length === 0
          ? [
              {
                ...EMPTY_VALUE,
                text: 'This handler declares no errors',
                note: 'Add @ApiErrors to list the ones it answers with',
              },
            ]
          : contractValues(errors.declared, 'declared in code');
      return [
        ...success,
        ...declared,
        ...contractValues(errors.runtimeDerived, 'derived from runtime'),
        ...contractValues(errors.global, 'application wide'),
      ];
    }
    case 'streaming': {
      const streaming = runtime.streaming;
      if (streaming === undefined) return [];
      return [
        {
          ...EMPTY_VALUE,
          text: streamingLabel(streaming.value),
          ...mark(streaming.confidence, streaming.collector),
        },
      ];
    }
    case 'source': {
      const source = runtime.source;
      if (source === undefined) return [];
      const expansion = expandSourceLink(template ?? '', source);
      return [
        {
          ...EMPTY_VALUE,
          text: `${source.controller}.${source.handler}()`,
          href: expansion.url ?? '',
          note:
            expansion.reason ?? (expansion.withoutLine === true ? 'file only, no source map' : ''),
        },
      ];
    }
    case 'required-headers': {
      const headers = runtime.requiredHeaders;
      if (headers === undefined) return [];
      return [
        {
          ...EMPTY_VALUE,
          text: headers.value.join(', '),
          note: 'named required in guard metadata',
          ...mark(headers.confidence, headers.collector),
        },
      ];
    }
    case 'validation':
      return pipeValues(runtime.pipes ?? []);
    case 'timeout': {
      const timeout = runtime.timeout;
      if (timeout === undefined) return [];
      return [
        {
          ...EMPTY_VALUE,
          text: timeoutLabel(timeout.value),
          ...mark(timeout.confidence, timeout.collector),
        },
      ];
    }
    case 'unread-parameters': {
      const reads = runtime.parameterReads;
      if (reads === undefined) return [];
      const label = parameterReadsLabel(reads.value);
      return [
        {
          ...EMPTY_VALUE,
          text: label.value,
          note: label.note,
          ...mark(reads.confidence, reads.collector),
        },
      ];
    }
  }
}

/**
 * Builds the parity scale of one operation.
 *
 * @param document - The normalized document, for the report and the link template
 * @param operation - The operation the page is about
 * @param issues - The recorded findings about this operation
 * @param basePath - Mount point, so the FixBar's code can link to the Health panel
 * @returns The eleven rows, in the design's order
 */
export function buildParityRows(
  document: IRDocument,
  operation: IROperation,
  issues: readonly IRDriftIssue[],
  basePath: string,
): ParityRowModel[] {
  const measured = document.health !== undefined;
  const template = document.runtime?.sourceLinkTemplate;
  const observed = observedFor(document);
  const observation = observationOf(document);

  return ROW_ORDER.map(([kind, label]) => {
    const values = runtimeSide(kind, operation, template);
    const rules = ROW_RULES[kind] ?? [];
    // THE FIRST RECORDED FINDING TAKES THE FIXBAR, in the report's own order, which is the
    // catalogue order of SPEC 7.1. A second finding on a two rule row is not lost: the panel's
    // card list keeps every finding whose code no row consumed.
    const issue = issues.find((candidate) => rules.includes(candidate.rule));

    let verdict: ParityVerdict = 'unknown';
    let severityClass = '';
    let fix: ParityFixModel | null = null;

    if (issue !== undefined) {
      verdict = 'drift';
      severityClass = SEVERITY_CLASSES[issue.severity];
      fix = {
        severityClass,
        text: issue.suggestion,
        code: DRIFT_RULE_CODES[issue.rule],
        // The panel lives on the health page since `TX-FRAME`, per SPEC 7.3, and the anchor
        // moved with it.
        href: `${healthPageHref(basePath)}#oref-rule-${issue.rule}`,
      };
    } else if (measured && rules.length > 0) {
      // `=` ONLY WHERE A RULE EXAMINED AND STAYED QUIET, per SPEC 6.3, extended over a list:
      // at least one rule in scope and clean, and none reporting a finding the report does not
      // carry. The second guard is belt over braces: the report ran the same rules, so a
      // `finding` outcome without a recorded issue should not occur, and answering `unknown`
      // there claims less rather than more.
      //
      // THE OBSERVATION IS PASSED SINCE `TX-INSTRUMENT`, and without it this call answered a
      // different question from the one the report answered. `security-drift` is out of scope with
      // no guard-to-scheme mapping, by its own rule, so every guarded operation whose security the
      // document does state drew `?` here while the health page counted it as passed. Two answers
      // to one comparison, from one rule, because only one caller had the input.
      const outcomes = rules.map((rule) => operationRuleOutcome(operation, rule, observation));
      if (outcomes.includes('clean') && !outcomes.includes('finding')) verdict = 'match';
    }

    const [field, noun] = ROW_SUBJECT[kind];
    // THE REASON ANSWERS WHICHEVER OF THE TWO SILENCES THIS IS. An empty side is explained by the
    // instrument, per SPEC 6.3; a full side with no verdict is explained by the catalogue, and
    // before `TX-INSTRUMENT` the second had no words at all outside an `aria-label`.
    const reason =
      values.length === 0
        ? instrumentReason(runtimeInstrument(document.runtime, field, observed), noun)
        : verdict === 'unknown'
          ? NO_RULE_YET
          : '';

    return {
      kind,
      label,
      spec: specSide(kind, operation),
      runtime: values,
      reason,
      verdict,
      severityClass,
      fix,
    };
  });
}

/**
 * The facts this document actually carries, computed once however many pages are built from it.
 *
 * A `WeakMap` RATHER THAN A PARAMETER, because `buildRuntimeModel` is exported and every page of a
 * document would otherwise pay a walk of every node: one page is cheap and a thousand pages of a
 * thousand nodes is a million node visits for an answer that cannot change. A document is frozen
 * once it is hashed, so identity is a sound key.
 */
const OBSERVED = new WeakMap<IRDocument, ReadonlyMap<RuntimeFactField, string>>();

/**
 * @param document - The document a page is being built from
 * @returns Which facts something reported, and who reported each
 */
function observedFor(document: IRDocument): ReadonlyMap<RuntimeFactField, string> {
  const held = OBSERVED.get(document);
  if (held !== undefined) return held;

  const computed = observedFactCollectors(document);
  OBSERVED.set(document, computed);

  return computed;
}

/**
 * What this caller can hand a rule it re-asks, out of what the document carries.
 *
 * `handledNodeIds` IS NOT SUPPLIED AND MUST NOT BE INVENTED. A document does not record which of
 * its operations the pass paired with a handler, so an empty set here would tell `orphan-operation`
 * that every operation is an orphan. Its absence is what says this caller cannot answer that
 * question, and the rule reads it that way.
 *
 * @param document - The document a page is being built from
 * @returns The observation, or nothing when the document carries no mapping to re-ask with
 */
function observationOf(document: IRDocument): DriftObservation | undefined {
  const schemes = document.runtime?.guardSchemes;
  if (schemes === undefined) return undefined;

  return { guardSchemes: new Map(Object.entries(schemes)) };
}
