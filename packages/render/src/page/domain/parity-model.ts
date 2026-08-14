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
 * FOUR ROWS HAVE NO FACT UNTIL THEIR COLLECTORS EXIST, required headers, validation, timeout
 * and unread parameters, and they are rows all the same: the runtime side is empty and the
 * `reason` names why, which the component draws as the hatched cell of the design. The row set
 * is complete from the first day and fills in as collectors arrive, and the phrase is honest
 * about the instrument rather than silent about the application: "nothing reads this yet" is a
 * statement about OPENREF, and it stands in the one cell whose absence would otherwise read as
 * a statement about the route.
 *
 * EVERYTHING HERE IS DECIDED ON THE SERVER, once per document hash, like the rest of the page
 * model: the limit is already in words, the source link is already expanded, the code is
 * already looked up. A branch not taken here is a branch that is not in the bundle every
 * reader downloads.
 */

import {
  DRIFT_RULE_CODES,
  expandSourceLink,
  operationRuleOutcome,
  type IRDocument,
  type IRDriftIssue,
  type IRDriftRule,
  type IRErrorContract,
  type IROperation,
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
  rateLimitLabel,
  SEVERITY_CLASSES,
  streamingLabel,
} from './runtime-values';

/** What the specification says when it says nothing, which the design prints rather than hides. */
const NOT_DESCRIBED = 'not described';

/** The reason phrase of a fact row whose fact is absent: observed silence, never asserted absence. */
const NOTHING_OBSERVED = 'Nothing observed here.';

/**
 * The reason phrases of the four collector-less rows, naming the missing instrument.
 *
 * Each states what does not exist yet, because the empty cell is a statement about OPENREF and
 * not about the route: a phrase like "no validation" would assert a fact nobody collected,
 * which is the guess SPEC 6.1 refuses.
 */
const NO_COLLECTOR: Partial<Record<ParityRowKind, string>> = {
  'required-headers': 'Header requiredness sits in guard metadata nothing reads yet.',
  validation: 'No collector reads pipes yet.',
  timeout: 'No collector reads interceptors yet.',
  'unread-parameters': 'Handler reads are a compile time scan that does not exist yet.',
};

/** The rule that gives each row its verdict, for the rows that have one today. */
const ROW_RULES: Partial<Record<ParityRowKind, IRDriftRule>> = {
  authentication: 'security-drift',
  scopes: 'scope-drift',
  'rate-limit': 'ratelimit-undocumented',
  'response-codes': 'error-undocumented',
  streaming: 'stream-unspecified',
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
      return side(statuses.join(' '), `${String(statuses.length)} codes declared`);
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
      return side(`${String(count)} parameters declared`);
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
      if (errors === undefined) return [];
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
    case 'required-headers':
    case 'validation':
    case 'timeout':
    case 'unread-parameters':
      return [];
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

  return ROW_ORDER.map(([kind, label]) => {
    const values = runtimeSide(kind, operation, template);
    const rule = ROW_RULES[kind];
    const issue =
      rule === undefined ? undefined : issues.find((candidate) => candidate.rule === rule);

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
    } else if (
      measured &&
      rule !== undefined &&
      operationRuleOutcome(operation, rule) === 'clean'
    ) {
      verdict = 'match';
    }

    return {
      kind,
      label,
      spec: specSide(kind, operation),
      runtime: values,
      reason: values.length > 0 ? '' : (NO_COLLECTOR[kind] ?? NOTHING_OBSERVED),
      verdict,
      severityClass,
      fix,
    };
  });
}
