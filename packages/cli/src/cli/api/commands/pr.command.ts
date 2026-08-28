import { appendFile, readFile } from 'node:fs/promises';
import { buildDiffReport, type IRDiffReport, type IRDocument } from '@openref/core';
import { isBuildTarget, type BuildTarget } from '@openref/static';
import { loadDocument } from '../../application/services/load-document.service';
import { renderStaticSite } from '../../application/services/static-build.service';
import { parseApiOrigin, type ApiOrigin } from '../../domain/api-origin';
import type { CommandContext, CommandOutcome } from '../../domain/command.types';
import { EXIT_CODE } from '../../domain/exit-code.constants';
import { refusedGitArgument } from '../../domain/git-ref';
import {
  readPullRequestEvent,
  REFUSED_EVENT_NAME,
  type PullRequestEvent,
} from '../../domain/pr-event';
import {
  PR_BOOLEAN_FLAGS,
  PR_OUTPUT_NAMES,
  PR_VALUE_FLAGS,
  resolvePrInputs,
  type Environment,
  type PrInputs,
} from '../../domain/pr-inputs';
import { parseRepositorySlug, type RepositorySlug } from '../../domain/repository-slug';
import {
  COMMENTS_PER_PAGE,
  MAX_COMMENT_PAGES,
  upsertMarkedComment,
} from '../../infrastructure/adapters/github-comment.adapter';
import { parseArgs, unknownFlagRefusal, type FlagValue } from '../argv';
import { PR_USAGE } from '../help';
import { PR_COMMENT_MARKER, renderPrComment } from './pr-comment-text';

/**
 * `openref pr`: the whole of SPEC 17.2, in the CLI rather than in a bundled action.
 *
 * WHY IT IS HERE AND NOT IN `action.yml`. A workflow file is code nothing in this repository
 * runs, and a rule with no runner is not a rule. Everything this command does is covered by this
 * package's tests, published with this package, and runnable by hand; what is left in the action
 * definition is one step with one literal command in it.
 *
 * THE GATE IS OPT IN, exactly as `doctor --fail-on` is and for the same reason: the first run in
 * a pipeline that has never seen this command must produce a comment, not a red pull request.
 * Without `--fail-on-breaking` the exit code is 0 whatever the diff says.
 *
 * DEGRADING IS A PATH, NOT A FAILURE. A fork pull request holds a read only token, so no request
 * is sent at all rather than sent and refused; the body goes to the step summary and to stdout,
 * the reason is named on stderr, and the run ends 0. `pull_request_target` is the one event this
 * refuses outright, per SPEC 17.2 and SPEC 19: under it a write scoped token is issued while the
 * head is somebody else's, and a step that then builds that head has handed the token away.
 *
 * AN UNDETERMINABLE FORK STATUS REFUSES RATHER THAN ASSUMING A TRUSTED CONTEXT. `fromFork` fails
 * closed only once the payload has parsed; a `GITHUB_EVENT_PATH` that is named and cannot be read
 * says nothing about where the head came from, and `--repository` with `--pull-request` would
 * carry such a run all the way to a request. So a named and unreadable payload stops the posting
 * path with exit 2, per SPEC 17.2. No `GITHUB_EVENT_PATH` at all is the other case and is
 * unchanged: there is no workflow event to be a fork of, which is the by hand run SPEC 17 promises.
 */

/** What the run decided to do about the comment, and why. */
export interface PrCommentDecision {
  readonly post: boolean;
  readonly reason: string;
}

/**
 * Whether this run may post, and the sentence it prints when it may not.
 *
 * @param options - The event, the token and whether the caller asked for a dry run
 * @returns The decision
 */
export function decideComment(options: {
  readonly event: PullRequestEvent | undefined;
  readonly token: string | undefined;
  readonly dryRun: boolean;
}): PrCommentDecision {
  if (options.dryRun) {
    return { post: false, reason: '--dry-run was given, so the comment is printed, not posted' };
  }
  if (options.token === undefined || options.token === '') {
    return {
      post: false,
      reason: 'GITHUB_TOKEN is not set, so there is nothing to post with; the comment is printed',
    };
  }
  if (options.event?.fromFork === true) {
    return {
      post: false,
      reason:
        'this pull request comes from a fork, where GITHUB_TOKEN is read only; the comment is printed rather than posted',
    };
  }
  return { post: true, reason: '' };
}

/**
 * The preview address, and the base the build is rendered under, derived from one input.
 *
 * ONE VALUE PRODUCES BOTH so that the address printed in the comment and the base every link in
 * the build was written with cannot disagree. Two inputs that happened to match would be one
 * fact recorded twice.
 *
 * @param previewBase - The root the preview is published under, absolute or a path
 * @param pullRequest - The pull request number
 * @returns The base for the build, which is also the address, or undefined
 */
export function previewBaseFor(
  previewBase: string | undefined,
  pullRequest: number | undefined,
): string | undefined {
  if (previewBase === undefined || previewBase === '') return undefined;
  if (pullRequest === undefined) return undefined;

  return `${previewBase.replace(/\/+$/, '')}/pr-${String(pullRequest)}`;
}

/** The exit code the outcome carries, once everything else is decided. */
function exitFor(report: IRDiffReport, failOnBreaking: boolean): CommandOutcome {
  return {
    exitCode: failOnBreaking && report.breaking.length > 0 ? EXIT_CODE.FINDINGS : EXIT_CODE.SUCCESS,
  };
}

export async function runPr(context: CommandContext): Promise<CommandOutcome> {
  const { flags, unknown } = parseArgs(
    context.args,
    [...PR_VALUE_FLAGS, 'target'],
    PR_BOOLEAN_FLAGS,
  );
  const env: Environment = context.env ?? {};

  if (flags.has('help')) {
    context.stdout(PR_USAGE);
    return { exitCode: EXIT_CODE.SUCCESS };
  }

  // NAMED AND REFUSED RATHER THAN IGNORED. A caller who writes `--token` has a credential on
  // their command line right now; saying nothing would leave them believing it was used.
  if (flags.has('token')) {
    context.stderr(
      `openref pr: --token does not exist. A token on the command line is visible in ps and in shell history; set GITHUB_TOKEN instead\n`,
    );
    return { exitCode: EXIT_CODE.USAGE_ERROR };
  }

  // AFTER `--token`, SO THE FLAG THAT HAS ITS OWN REASON KEEPS IT. Everything else undeclared is
  // the SPEC 17 usage error `T043` found `doctor` accepting in silence.
  const flagRefusal = unknownFlagRefusal(
    'pr',
    unknown.filter((name) => name !== 'token'),
  );
  if (flagRefusal !== undefined) {
    context.stderr(`${flagRefusal}\n\n${PR_USAGE}`);
    return { exitCode: EXIT_CODE.USAGE_ERROR };
  }

  if (env.GITHUB_EVENT_NAME === REFUSED_EVENT_NAME) {
    context.stderr(
      `openref pr: this refuses to run on ${REFUSED_EVENT_NAME}. That event issues a write scoped token while the head belongs to somebody else, so a job that checks the head out has given the token away. Run on pull_request, per SPEC 17.2\n`,
    );
    return { exitCode: EXIT_CODE.USAGE_ERROR };
  }

  const inputs = resolvePrInputs(flags, env);
  if ('usageError' in inputs) {
    context.stderr(`openref pr: ${inputs.usageError}\n\n${PR_USAGE}`);
    return { exitCode: EXIT_CODE.USAGE_ERROR };
  }

  if (inputs.spec === undefined) {
    context.stderr(`openref pr: --spec <path> is required\n\n${PR_USAGE}`);
    return { exitCode: EXIT_CODE.USAGE_ERROR };
  }

  // PARSED HERE, WHICH IS BEFORE ANY REQUEST IS FORMED, per SPEC 17.2 and SPEC 19.11. The value
  // is the second half of the API address and used to travel into it as written. Nothing trims it
  // on the way in, so a value with whitespace in it is refused rather than repaired, whichever of
  // the three sources supplied it; and the refusal names that source rather than always the flag.
  const repositoryValue = inputs.repository ?? env.GITHUB_REPOSITORY;
  const repositorySource =
    inputs.repository === undefined
      ? 'GITHUB_REPOSITORY'
      : (inputs.repositorySource ?? '--repository');
  let repository: RepositorySlug | undefined;
  if (repositoryValue !== undefined && repositoryValue !== '') {
    const parsed = parseRepositorySlug(repositoryValue, repositorySource);
    if ('usageError' in parsed) {
      context.stderr(`openref pr: ${parsed.usageError}\n`);
      return { exitCode: EXIT_CODE.USAGE_ERROR };
    }
    repository = parsed;
  }

  const reading = await readEvent(env, context);
  const event = reading.kind === 'event' ? reading.event : undefined;
  const baseRef = inputs.base ?? event?.baseSha ?? event?.baseRef;
  if (baseRef === undefined) {
    context.stderr(
      `openref pr: no base ref. Give --base <ref>, or run where GITHUB_EVENT_PATH names a pull request\n`,
    );
    return { exitCode: EXIT_CODE.USAGE_ERROR };
  }

  const refusal = refusedGitArgument(baseRef, 'the base ref');
  if (refusal !== undefined) {
    context.stderr(`openref pr: ${refusal}\n`);
    return { exitCode: EXIT_CODE.USAGE_ERROR };
  }

  const target = readTarget(flags.get('target'));
  if (typeof target === 'object' && 'usageError' in target) {
    context.stderr(`openref pr: ${target.usageError}\n`);
    return { exitCode: EXIT_CODE.USAGE_ERROR };
  }

  let report: IRDiffReport;
  let head: IRDocument;
  try {
    const older = await loadDocument({ kind: 'git', ref: baseRef, path: inputs.spec });
    await older.close();
    const newer = await loadDocument({ kind: 'spec', path: inputs.spec });
    await newer.close();
    head = newer.document;
    report = buildDiffReport(older.document, head);
  } catch (error) {
    context.stderr(`openref pr: ${error instanceof Error ? error.message : String(error)}\n`);
    return { exitCode: EXIT_CODE.USAGE_ERROR };
  }

  const pullRequest = readPullRequestNumber(inputs, event);
  const derived = previewBaseFor(inputs.previewBase, pullRequest);
  const previewUrl = inputs.previewUrl ?? derived;

  if (inputs.out !== undefined) {
    try {
      const built = await renderStaticSite({
        // THE SAME DOCUMENT THE DIFF'S NEW SIDE WAS BUILT FROM. Reading the file a second time
        // would let the preview describe a state the report never compared against.
        document: head,
        out: inputs.out,
        base: derived,
        target,
        io: context,
      });
      context.stdout(
        `openref pr: built ${String(built.rendered.length + built.carried.length)} preview pages into ${inputs.out}\n`,
      );
    } catch (error) {
      context.stderr(
        `openref pr: the preview build failed: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      return { exitCode: EXIT_CODE.USAGE_ERROR };
    }
  }

  const body = renderPrComment(report, { previewUrl });
  const decision = decideComment({
    event,
    token: env.GITHUB_TOKEN,
    dryRun: inputs.dryRun,
  });

  if (!decision.post) {
    context.stdout(`${body}\n`);
    context.stderr(`openref pr: ${decision.reason}\n`);
    await appendStepSummary(env, body, context);
    await writeOutputs(env, { report, previewUrl, commentUrl: undefined }, context);
    return exitFor(report, inputs.failOnBreaking);
  }

  // THE POSTING PATH IS THE ONE THAT NEEDS TO KNOW WHERE THE HEAD CAME FROM. A payload that was
  // named and could not be read leaves fork status unknown, and SPEC 17.2 refuses that rather
  // than treating it as the trusted case.
  if (reading.kind === 'unreadable') {
    context.stderr(
      `openref pr: ${reading.reason}, so whether this pull request comes from a fork cannot be established. A run that cannot tell does not post, per SPEC 17.2\n`,
    );
    return { exitCode: EXIT_CODE.USAGE_ERROR };
  }

  const apiUrl = env.GITHUB_API_URL;
  if (repository === undefined || pullRequest === undefined || apiUrl === undefined) {
    context.stderr(
      `openref pr: a token is set, so this was asked to comment, and it cannot say where: ${[
        repository === undefined ? 'no repository (GITHUB_REPOSITORY or --repository)' : '',
        pullRequest === undefined ? 'no pull request number (event payload or --pull-request)' : '',
        apiUrl === undefined ? 'no API root (GITHUB_API_URL)' : '',
      ]
        .filter((part) => part !== '')
        .join(', ')}\n`,
    );
    return { exitCode: EXIT_CODE.USAGE_ERROR };
  }

  // THE ROOT IS PARSED BEFORE A TARGET EXISTS, per SPEC 19.11. Until this check, whoever could set
  // `GITHUB_API_URL` chose where a write scoped token was delivered, over any scheme they liked.
  const apiOrigin: ApiOrigin | { readonly usageError: string } = parseApiOrigin(apiUrl);
  if ('usageError' in apiOrigin) {
    context.stderr(`openref pr: ${apiOrigin.usageError}\n`);
    return { exitCode: EXIT_CODE.USAGE_ERROR };
  }

  try {
    const comment = await upsertMarkedComment(
      { apiOrigin, repository, pullRequest, token: env.GITHUB_TOKEN ?? '' },
      PR_COMMENT_MARKER,
      body,
    );
    context.stdout(
      `openref pr: ${comment.updated ? 'updated' : 'created'} the API review comment at ${comment.url}\n`,
    );
    // SAID OUT LOUD, BECAUSE A SECOND COMMENT ON THE THREAD OTHERWISE HAS NO EXPLANATION. Only a
    // comment written by the identity the token authenticates as is adopted, per SPEC 17.2, and
    // neither identity path could establish one here.
    if (comment.identity === undefined) {
      context.stderr(
        `openref pr: the API would not say which identity this token authenticates as, by a login or by an app, so no existing comment could be proven to be ours and a new one was posted\n`,
      );
    }
    // THE OTHER WAY A DUPLICATE APPEARS, AND IT IS NEVER SILENT EITHER. The search reads a fixed
    // number of pages; a thread longer than that can hide this tool's own comment past the end of
    // what was read, and every push then adds one more.
    if (comment.searchCapReached) {
      context.stderr(
        `openref pr: the search for our own comment stopped at its cap of ${String(MAX_COMMENT_PAGES)} pages of ${String(COMMENTS_PER_PAGE)}, so a comment of ours below the first ${String(MAX_COMMENT_PAGES * COMMENTS_PER_PAGE)} on this thread was never read and this run posted another one rather than updating it\n`,
      );
    }
    await appendStepSummary(env, body, context);
    await writeOutputs(env, { report, previewUrl, commentUrl: comment.url }, context);
  } catch (error) {
    context.stderr(`openref pr: ${error instanceof Error ? error.message : String(error)}\n`);
    return { exitCode: EXIT_CODE.USAGE_ERROR };
  }

  return exitFor(report, inputs.failOnBreaking);
}

/** The pull request number, from the flag first and the event second. */
function readPullRequestNumber(
  inputs: PrInputs,
  event: PullRequestEvent | undefined,
): number | undefined {
  if (inputs.pullRequest !== undefined) {
    const parsed = Number(inputs.pullRequest);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return event?.number;
}

/** Reads `--target`, which is optional here and never auto detected: a preview has one home. */
function readTarget(
  value: FlagValue | undefined,
): BuildTarget | undefined | { readonly usageError: string } {
  if (value === undefined) return undefined;
  if (value === true) return { usageError: '--target needs a value' };
  if (!isBuildTarget(value)) return { usageError: `--target does not know "${value}"` };
  return value;
}

/**
 * What reading `GITHUB_EVENT_PATH` produced.
 *
 * THE THREE OUTCOMES ARE KEPT APART BECAUSE TWO OF THEM USED TO BE ONE. "There is no workflow
 * event", which is the ordinary by hand run, and "there is one and this could not read it",
 * which is a wiring fault, both answered undefined, and the fork status guarantee quietly rested
 * on the difference.
 */
type EventReading =
  | { readonly kind: 'absent' }
  | { readonly kind: 'unreadable'; readonly reason: string }
  | { readonly kind: 'event'; readonly event: PullRequestEvent };

/**
 * Reads the event payload, or says which way it was not there.
 *
 * AN UNREADABLE PAYLOAD IS SAID OUT LOUD AND CARRIED OUT AS A KIND OF ITS OWN. The caller uses it
 * to refuse the posting path, per SPEC 17.2.
 */
async function readEvent(env: Environment, io: CommandContext): Promise<EventReading> {
  const path = env.GITHUB_EVENT_PATH;
  if (path === undefined || path === '') return { kind: 'absent' };

  let json: string;
  try {
    json = await readFile(path, 'utf8');
  } catch (error) {
    const reason = `GITHUB_EVENT_PATH names ${path}, which could not be read: ${error instanceof Error ? error.message : String(error)}`;
    io.stderr(`openref pr: ${reason}\n`);
    return { kind: 'unreadable', reason };
  }

  const event = readPullRequestEvent(json);
  if (event === undefined) {
    const reason = `the event payload at ${path} carries no pull request`;
    io.stderr(`openref pr: ${reason}\n`);
    return { kind: 'unreadable', reason };
  }
  return { kind: 'event', event };
}

/** Appends the body to the job summary, when the runner gave one. */
async function appendStepSummary(
  env: Environment,
  body: string,
  io: CommandContext,
): Promise<void> {
  const path = env.GITHUB_STEP_SUMMARY;
  if (path === undefined || path === '') return;

  try {
    await appendFile(path, `${body}\n`, 'utf8');
  } catch (error) {
    io.stderr(
      `openref pr: the step summary at ${path} could not be written: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
}

/**
 * Writes the step outputs a workflow reads.
 *
 * EVERY VALUE IS ONE LINE BY CONSTRUCTION AND IS CHECKED ANYWAY. A newline in a value written in
 * `name=value` form is how a step output becomes an injected second output, so a value carrying
 * one is refused rather than written.
 */
async function writeOutputs(
  env: Environment,
  result: {
    readonly report: IRDiffReport;
    readonly previewUrl: string | undefined;
    readonly commentUrl: string | undefined;
  },
  io: CommandContext,
): Promise<void> {
  const path = env.GITHUB_OUTPUT;
  if (path === undefined || path === '') return;

  const values: Readonly<Record<string, string>> = {
    'breaking-count': String(result.report.breaking.length),
    'change-count': String(result.report.breaking.length + result.report.nonBreaking.length),
    'preview-url': result.previewUrl ?? '',
    'comment-url': result.commentUrl ?? '',
  };

  const lines: string[] = [];
  for (const name of PR_OUTPUT_NAMES) {
    const value = values[name] ?? '';
    if (value.includes('\n') || value.includes('\r')) {
      io.stderr(`openref pr: the ${name} output holds a newline and was not written\n`);
      continue;
    }
    lines.push(`${name}=${value}`);
  }

  try {
    await appendFile(path, `${lines.join('\n')}\n`, 'utf8');
  } catch (error) {
    io.stderr(
      `openref pr: the step outputs at ${path} could not be written: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
}
