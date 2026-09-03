import { PACKAGE_NAME as CORE_PACKAGE } from '@openref/core';
import { PACKAGE_NAME as RUNNER_PACKAGE } from '@openref/runner';

/**
 * Name of this package.
 *
 * Exported so that the dependency graph linter has a real edge to follow and so that
 * diagnostics can report which package produced a value.
 */
export const PACKAGE_NAME = '@openref/samples';

/**
 * Packages this package is allowed to depend on, in the order declared by STANDARDS 3.5.
 *
 * THE EDGE TO `runner` IS THE WHOLE DESIGN AND NOT A CONVENIENCE. SPEC 18 requires the sample and
 * the console to read one source, and the source is `buildRequest`. A samples package that reached
 * only `core` would have to rebuild the style matrix, the body encoder and the credential rule,
 * and the day one of the four copies changed the reference would show a reader code that does not
 * match the button beside it.
 */
export const UPSTREAM_PACKAGES: readonly string[] = [CORE_PACKAGE, RUNNER_PACKAGE];

export { composeCodeSamples } from './generate/domain/compose';
export { withGeneratedSamples } from './generate/domain/document-samples';
export type {
  SampleBodyMediaType,
  SampleOperation,
  SampleOperationOf,
  SampleParameter,
} from './generate/domain/document-samples';
export { generateCodeSamples } from './generate/domain/generate';
export type { GeneratedSamples, SampleNote, SampleOmission } from './generate/domain/generate';
export {
  BYTE_BODY_REFUSAL,
  HTTPIE_MULTIPART_REFUSAL,
  HTTPIE_SEPARATOR_REFUSAL,
  NON_ASCII_HEADER_REFUSAL,
  OKHTTP_MISSING_BODY_REFUSAL,
  POWERSHELL_MULTIPART_REFUSAL,
  POWERSHELL_TYPED_EMPTY_REFUSAL,
  REDIRECT_CREDENTIAL_DROPPED_NOTE,
  REDIRECT_NOT_FOLLOWED_NOTE,
  SAMPLE_LANGUAGES,
  UNSENDABLE_PLAN_REFUSAL,
  UNTYPED_BODY_REFUSAL,
  WGET_MULTIPART_REFUSAL,
} from './generate/domain/languages';
export type {
  EmitOutcome,
  SampleLanguage,
  SampleLanguageId,
  SampleLevel,
} from './generate/domain/languages';
export {
  BASIC_CREDENTIAL_PLACEHOLDER,
  buildSampleRequest,
  placeholderCredentials,
} from './generate/domain/sample-request';
export type {
  PlaceholderCredentials,
  SampleRequest,
  UnsendableScheme,
} from './generate/domain/sample-request';
