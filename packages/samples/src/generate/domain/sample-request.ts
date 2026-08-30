/**
 * The one door between an operation and a code sample, per SPEC 18.
 *
 * THE SAMPLE AND THE BUTTON READ THE SAME SOURCE, AND THIS FILE IS WHERE THAT IS TRUE RATHER THAN
 * PROMISED. `buildRequest` in `@openref/runner` is the only thing in this repository that turns an
 * operation plus what a reader typed into a method, a url, headers and a body; the emitters below
 * it format a {@link RequestPlan} and serialize nothing. A generator that re-implemented the style
 * matrix, the content type rule or the credential shape would be a second answer to the question
 * the console already answers, and the failure mode SPEC 18 names, copied code that does not match
 * the pressed button, is exactly a second answer drifting from the first.
 *
 * THE PLAN IS NOT THE WHOLE INPUT, and the reason is bytes. A multipart or binary body reaches the
 * plan as `Uint8Array`, which no sample can print, so the reader's own body travels beside the plan
 * and the three level 1 emitters render its parts. Nothing is reconstructed from the bytes.
 */

import { unsendableSchemeCause } from '@openref/core';
import type { UnsendableCause } from '@openref/core';
import { applyCredentials, buildRequest } from '@openref/runner';
import type {
  RequestInputs,
  RequestPlan,
  RunnableOperation,
  RunnableSecurityScheme,
  RunnerBody,
} from '@openref/runner';

/**
 * One request, as the runner would send it, plus the body shape the plan's bytes cannot show.
 *
 * `contentType` is read off the plan rather than off the inputs, because `buildRequest` is what
 * decides it: a multipart body replaces a declared header, everything else defers to one.
 */
export interface SampleRequest {
  /** The plan the runner would hand a transport. */
  readonly plan: RequestPlan;
  /** What the reader supplied as a body, or null when they supplied none. */
  readonly body: RunnerBody | null;
  /** Content type of the request, or null when it carries no body. */
  readonly contentType: string | null;
}

/**
 * Placeholder credentials, and the schemes no sample may carry a credential for.
 *
 * TWO LISTS RATHER THAN ONE, for the reason T028 and T055 both give: a value the runner refuses to
 * send and a scheme a page has to explain are two different facts, and folding them into one makes
 * the second unsayable. `values` is what a caller passes to {@link buildSampleRequest};
 * `unsendable` is what a caller prints beside the sample instead of a line of code that would not
 * work.
 */
export interface PlaceholderCredentials {
  /** Placeholder credential per scheme id, for the schemes a request can carry. */
  readonly values: Readonly<Record<string, string>>;
  /** Schemes whose credential cannot travel in a request, with the cause `core` gives. */
  readonly unsendable: readonly UnsendableScheme[];
}

/** One security scheme whose credential a request cannot carry. */
export interface UnsendableScheme {
  readonly schemeId: string;
  readonly cause: UnsendableCause;
}

/**
 * The placeholder a basic scheme takes, which is the pair RFC 7617 defines and not a token.
 *
 * IT IS THE UNENCODED PAIR ON PURPOSE. `applyCredentials` base64 encodes whatever it is given, so
 * the sample prints `Basic PHVzZXI+OjxwYXNzd29yZD4=`, which is what the runner puts on the wire.
 * Printing a readable pair instead would be a sample that does not match the button. The encoded
 * form is pinned in `sample-request.spec.ts`, because a figure written only in a comment is a
 * figure that rots.
 */
export const BASIC_CREDENTIAL_PLACEHOLDER = '<user>:<password>';

/**
 * Placeholder credentials for the schemes an operation requires.
 *
 * A SAMPLE THAT REACHES A PAGE MAY NOT CARRY A REAL CREDENTIAL, per SPEC 19.7: a rendered
 * reference is cached, served and statically built, and a credential in it is a credential
 * published. The placeholders are derived from the scheme id, so they are deterministic, obviously
 * not secrets, and different for each scheme a reader has to fill in.
 *
 * @param schemes - Security schemes the operation requires
 * @returns Placeholder values and the schemes that can carry none
 *
 * @example
 * const { values } = placeholderCredentials(operation.security);
 * buildSampleRequest(operation, inputs, values);
 */
export function placeholderCredentials(
  schemes: readonly RunnableSecurityScheme[],
): PlaceholderCredentials {
  const values: Record<string, string> = {};
  const unsendable: UnsendableScheme[] = [];

  for (const scheme of schemes) {
    const cause = unsendableSchemeCause(scheme);
    if (cause !== undefined) {
      unsendable.push({ schemeId: scheme.id, cause });
      continue;
    }

    values[scheme.id] = placeholderFor(scheme);
  }

  return { values, unsendable };
}

/** The placeholder one scheme takes, which is its id unless the shape of the value says more. */
function placeholderFor(scheme: RunnableSecurityScheme): string {
  const named = (scheme.scheme ?? '').toLowerCase();
  if (scheme.type === 'http' && named === 'basic') return BASIC_CREDENTIAL_PLACEHOLDER;

  return `<${scheme.id}>`;
}

/**
 * Builds the request a sample is written from.
 *
 * THE CREDENTIALS GO IN BEFORE THE PLAN IS BUILT AND NOT AFTER. `applyCredentials` decides where a
 * scheme's value travels, and `buildRequest` lets an auth header override a header parameter of
 * the same name; substituting a placeholder into a finished plan would put it in whatever place a
 * string search found and would not survive either rule.
 *
 * @param operation - The operation as `runnerOperationOf` projected it
 * @param inputs - What the reader typed, exactly as the console would pass it
 * @param credentials - Credential per scheme id, defaulting to none at all
 * @returns The request, ready to be emitted in any language
 * @throws {SerializationError} When the runner refuses to build this request
 * @throws {AuthError} When a credential is one a request cannot carry
 *
 * @example
 * const request = buildSampleRequest(operation, { values: {}, serverUrl });
 */
export function buildSampleRequest(
  operation: RunnableOperation,
  inputs: RequestInputs,
  credentials: Readonly<Record<string, string>> = {},
): SampleRequest {
  const plan = buildRequest(operation, inputs, applyCredentials(operation.security, credentials));

  return {
    plan,
    body: inputs.body ?? null,
    contentType: contentTypeOf(plan),
  };
}

/**
 * The content type of a plan, found without assuming the case its producer wrote.
 *
 * `buildRequest` writes `Content-Type`, a header parameter may write any spelling of it, and HTTP
 * field names are case insensitive. Reading one spelling would drop a document's own casing.
 *
 * THE LAST LINE IS A NARROWING RATHER THAN A CASE. `resolveBody` sets a content type for every
 * body it produces, so a plan with a body and no such header does not arise today; returning null
 * rather than asserting keeps a future body form that carries its own header from arriving here as
 * a crash.
 */
function contentTypeOf(plan: RequestPlan): string | null {
  if (plan.body === null) return null;

  for (const [name, value] of Object.entries(plan.headers)) {
    if (name.toLowerCase() === 'content-type') return value;
  }

  return null;
}
