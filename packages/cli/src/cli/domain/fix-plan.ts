import { isMechanicallyFixable } from '@openref/core';
import type {
  IRConfidence,
  IRDoctorFinding,
  IRDoctorReport,
  IRDriftAssertion,
  IRDriftRule,
} from '@openref/core';

/**
 * The plan `doctor --fix` makes before it opens a single source file, per SPEC 7.4 and 17.
 *
 * PURE, AND THAT IS THE WHOLE REASON IT IS A FILE OF ITS OWN. Deciding what may be written is a
 * function of the report and of nothing else: no filesystem, no git, no AST. The half that reads
 * source can then refuse an edit this half proposed, which is a narrowing and never a widening,
 * so the question "could this run ever write something it should not" is answered by reading one
 * pure function rather than by reading a rewriter.
 *
 * THE CLASSIFICATION IS READ, NEVER RECOMPUTED. `ai-docs/REMEDIATION.md` section 2 records the
 * correction this enforces: the bucket belongs to the finding, computed by T022 from the state of
 * the node, and a fix mode that reconstructed it from a table keyed by rule id would hand a
 * conflicting assertion to a rewriter the first time a node already asserted something. There is
 * no such table here. What is keyed by rule below is nothing: the edit is built from
 * {@link IRDriftAssertion}, which the rule that found the drift filled in with values.
 */

/** The decorator a mechanically fixable finding would have written above its handler. */
export interface FixDecorator {
  /** The decorator as it will appear in source, without indentation or a trailing newline. */
  readonly text: string;
  /** The name that has to be in scope from `@nestjs/swagger` for the decorator to compile. */
  readonly importName: string;
  /**
   * Which decorators already on the handler make this edit an alteration rather than an addition.
   *
   * SPEC 7.4 refuses an edit that would have to reach inside a decorator that already exists, and
   * this is that refusal expressed as data. `operationId` lives inside `@ApiOperation`, so one
   * already there is the refusal; a second `@ApiResponse` for a status nothing documents sits
   * beside the first and alters nothing, so only one naming the same status refuses.
   */
  readonly conflictsWith: DecoratorConflict;
}

/** What already being on the handler stops an edit. */
export type DecoratorConflict =
  /** Any decorator with one of these names, whatever its arguments say. */
  | { readonly kind: 'any-of'; readonly names: readonly string[] }
  /** A response decorator documenting this status, which is the only one that would collide. */
  | { readonly kind: 'response-status'; readonly status: number };

/** One edit the plan proposes, with everything a reader needs to judge it without the source. */
export interface PlannedEdit {
  readonly rule: IRDriftRule;
  readonly code: string;
  readonly confidence: IRConfidence;
  /** `METHOD /path`, as the report names it. */
  readonly subject: string;
  /** Repository relative path of the file the handler lives in. */
  readonly file: string;
  readonly controller: string;
  readonly handler: string;
  readonly decorator: FixDecorator;
}

/** Why a finding was not written into source. Every one of these is printed beside its finding. */
export type FixSkipReason =
  /** The specification asserts one thing and the runtime another, so no edit is ever safe. */
  | 'contradiction'
  /** The classifier sent it to a person, and `detail` says which of the three reasons. */
  | 'manual'
  /** A guard was observed and the host configured no guard to scheme mapping to name it. */
  | 'unconfigured-mapping'
  /** The edit would have had to reach inside a decorator the handler already carries. */
  | 'existing-decorator'
  /** Nothing says which file and which handler, so there is nowhere to write. */
  | 'no-source-location'
  /** The classifier calls it fixable and no mechanical edit could be spelled for it. */
  | 'no-mechanical-edit';

/** One finding the run left alone, with the reason a reader can act on. */
export interface SkippedFinding {
  readonly rule: IRDriftRule;
  readonly code: string;
  readonly subject: string;
  readonly reason: FixSkipReason;
  /** One sentence saying what the reason means for this finding in particular. */
  readonly detail: string;
}

/** What the pure half decided about every finding in the report. */
export interface FixPlan {
  readonly edits: readonly PlannedEdit[];
  readonly skipped: readonly SkippedFinding[];
}

/**
 * A string safe to write inside single quotes without escaping anything.
 *
 * THE ALTERNATIVE IS ESCAPING, AND ESCAPING IS WHERE A REWRITER GETS A FILE WRONG. A scheme name
 * or a method name outside this set is refused with a reason rather than quoted cleverly, which
 * costs one finding and cannot cost a broken file.
 */
const SAFE_LITERAL = /^[A-Za-z0-9_][A-Za-z0-9_.:-]*$/;

/**
 * A sentence safe to write inside single quotes, which is a wider set and still not a general one.
 *
 * A DESCRIPTION IS PROSE AND A SCHEME NAME IS AN IDENTIFIER, so one pattern for both would either
 * refuse `Too Many Requests` or admit a quote. Neither a quote, a backslash, a newline nor a
 * template opener can pass here, so nothing this writes can end the literal it is inside.
 */
const SAFE_SENTENCE = /^[A-Za-z0-9 ,.:;()/-]{1,120}$/;

/** Every security decorator `@nestjs/swagger` ships, so an operation already asserting one is seen. */
const SECURITY_DECORATORS: readonly string[] = [
  'ApiSecurity',
  'ApiBearerAuth',
  'ApiBasicAuth',
  'ApiCookieAuth',
  'ApiOAuth2',
];

/**
 * The decorator an assertion becomes, or undefined when it cannot be written as one.
 *
 * @param assertion - What the rule observed, in values
 * @returns The decorator, or undefined when no literal can be spelled for it
 */
export function decoratorFor(assertion: IRDriftAssertion): FixDecorator | undefined {
  switch (assertion.kind) {
    case 'security-scheme':
      if (!SAFE_LITERAL.test(assertion.scheme)) return undefined;
      return {
        text: `@ApiSecurity('${assertion.scheme}')`,
        importName: 'ApiSecurity',
        conflictsWith: { kind: 'any-of', names: SECURITY_DECORATORS },
      };

    case 'response-status': {
      if (!Number.isInteger(assertion.status)) return undefined;
      const description =
        assertion.description === undefined || !SAFE_SENTENCE.test(assertion.description)
          ? undefined
          : assertion.description;
      const body =
        description === undefined
          ? `{ status: ${String(assertion.status)} }`
          : `{ status: ${String(assertion.status)}, description: '${description}' }`;
      return {
        text: `@ApiResponse(${body})`,
        importName: 'ApiResponse',
        conflictsWith: { kind: 'response-status', status: assertion.status },
      };
    }

    case 'operation-id':
      if (!SAFE_LITERAL.test(assertion.operationId)) return undefined;
      return {
        text: `@ApiOperation({ operationId: '${assertion.operationId}' })`,
        importName: 'ApiOperation',
        conflictsWith: { kind: 'any-of', names: ['ApiOperation'] },
      };

    case 'unnameable':
      return undefined;
  }
}

/** What a manual finding's own reason means for somebody reading the summary. */
const MANUAL_DETAIL: Record<string, string> = {
  'structural-ambiguity':
    'the edit would narrow an assertion that already exists rather than fill a silence',
  'confidence-starvation':
    'the fact behind it is inferred, and writing a guess into source as a declaration is irreversible',
  'no-observed-fact': 'nothing was observed that an edit could describe',
};

/**
 * Decides what a finding gets: an edit, or a reason it was left alone.
 *
 * @param finding - One finding of the report, exactly as `buildDoctorReport` produced it
 * @returns The edit or the skip
 */
function planOne(finding: IRDoctorFinding): PlannedEdit | SkippedFinding {
  const head = { rule: finding.rule, code: finding.code, subject: finding.subject };

  const basis =
    finding.confidence === undefined
      ? ({ kind: 'unobserved' } as const)
      : ({ kind: 'collected', confidence: finding.confidence } as const);

  if (!isMechanicallyFixable(finding.classification, basis)) {
    if (finding.classification.bucket === 'contradiction') {
      return {
        ...head,
        reason: 'contradiction',
        detail:
          'the specification and the runtime assert different things and neither side is known to be the wrong one',
      };
    }

    const reason =
      finding.classification.bucket === 'manual'
        ? finding.classification.reason
        : 'no-observed-fact';

    return {
      ...head,
      reason: 'manual',
      detail: `${reason}: ${MANUAL_DETAIL[reason] ?? 'a person has to decide this one'}`,
    };
  }

  // PAST HERE THE CLASSIFIER HAS SAID YES, so every remaining refusal is this tool saying it does
  // not know something, and each one says which thing.
  if (finding.assertion?.kind === 'unnameable') {
    return {
      ...head,
      reason: 'unconfigured-mapping',
      detail:
        'a guard was observed and runtime.guardSecuritySchemes names no scheme for it, so there is no name to assert',
    };
  }

  const decorator = finding.assertion === undefined ? undefined : decoratorFor(finding.assertion);
  if (decorator === undefined) {
    return {
      ...head,
      reason: 'no-mechanical-edit',
      detail:
        finding.assertion === undefined
          ? 'the rule named no assertion this tool could write, so the fix is the one the suggestion describes'
          : 'the observed value cannot be written as a literal, so it is left to a person rather than escaped',
    };
  }

  const source = finding.source;
  if (source?.file === undefined) {
    return {
      ...head,
      reason: 'no-source-location',
      detail:
        source === undefined
          ? 'no source collector located this handler, so nothing names the file to write to'
          : 'the handler was located outside a repository, so no repository relative path names the file',
    };
  }

  // NARROWED, NOT ASSUMED: `isMechanicallyFixable` returned true, which it only does for a
  // `collected` basis, so the confidence is present and this is reading it rather than defaulting.
  const confidence = finding.confidence ?? 'derived';

  return {
    rule: finding.rule,
    code: finding.code,
    confidence,
    subject: finding.subject,
    file: source.file,
    controller: source.controller,
    handler: source.handler,
    decorator,
  };
}

/** Tells the two shapes {@link planOne} returns apart. */
function isEdit(planned: PlannedEdit | SkippedFinding): planned is PlannedEdit {
  return 'decorator' in planned;
}

/**
 * Plans every edit a `--fix` run would make, and names every finding it would leave alone.
 *
 * THE ORDER IS THE REPORT'S ORDER AND NOTHING RESORTS IT, so `--dry-run` and `--fix` print the
 * same list in the same order, which SPEC 7.4 requires and a test asserts rather than assumes.
 *
 * @param report - The doctor report, from `--from-nest`
 * @returns Every proposed edit and every skipped finding, in report order
 */
export function planFixes(report: IRDoctorReport): FixPlan {
  const edits: PlannedEdit[] = [];
  const skipped: SkippedFinding[] = [];

  for (const finding of report.findings) {
    const planned = planOne(finding);
    if (isEdit(planned)) edits.push(planned);
    else skipped.push(planned);
  }

  return { edits, skipped };
}
