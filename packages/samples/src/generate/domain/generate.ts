/**
 * The generator, per SPEC 18: one request in, up to nine samples out, plus the languages that
 * could not write it and why.
 *
 * THE OMISSIONS ARE RETURNED RATHER THAN SWALLOWED. A generator that quietly produced six samples
 * where nine were asked for would leave a caller unable to tell "this language has nothing to say
 * about this request" from "the generator is broken", which is the shape of defect CLAUDE.md's
 * fifth lesson is about. The list is data, so a doctor rule or a page can print it.
 *
 * THE EMITTER TABLE IS A TOTAL RECORD over {@link SampleLanguageId}, so a tenth language is a
 * compile error here rather than a tab that renders nothing.
 */

import type { IRCodeSample } from '@openref/core';
import { emitCurl } from './emit-curl';
import { emitFetch } from './emit-fetch';
import { emitHttpx } from './emit-httpx';
import { emitCsharp, emitGo, emitJava, emitPhp, emitRuby, emitRust } from './emit-templates';
import { SAMPLE_LANGUAGES } from './languages';
import type { EmitOutcome, SampleLanguage, SampleLanguageId } from './languages';
import type { SampleRequest } from './sample-request';

/** One language that produced no sample for this request, with the reason it gave. */
export interface SampleOmission {
  readonly lang: SampleLanguageId;
  /** What the tab would have said, so a caller can name the language a reader would look for. */
  readonly label: string;
  readonly reason: string;
}

/** What the generator produced, and what it did not. */
export interface GeneratedSamples {
  readonly samples: readonly IRCodeSample[];
  readonly omitted: readonly SampleOmission[];
}

/** Every emitter, keyed by the language it writes. */
const EMITTERS: Readonly<Record<SampleLanguageId, (request: SampleRequest) => EmitOutcome>> = {
  shell: emitCurl,
  typescript: emitFetch,
  python: emitHttpx,
  go: emitGo,
  php: emitPhp,
  java: emitJava,
  csharp: emitCsharp,
  ruby: emitRuby,
  rust: emitRust,
};

/**
 * Generates the samples for one request.
 *
 * @param request - The request the runner would send, from `buildSampleRequest`
 * @param languages - Languages to write, defaulting to all nine of SPEC 18 in their order
 * @returns The samples, in the order the languages were asked for, and the omissions
 *
 * @example
 * const { samples } = generateCodeSamples(buildSampleRequest(operation, inputs));
 */
export function generateCodeSamples(
  request: SampleRequest,
  languages: readonly SampleLanguage[] = SAMPLE_LANGUAGES,
): GeneratedSamples {
  const samples: IRCodeSample[] = [];
  const omitted: SampleOmission[] = [];

  for (const language of languages) {
    const outcome = EMITTERS[language.id](request);

    if (outcome.kind === 'refused') {
      omitted.push({ lang: language.id, label: language.label, reason: outcome.reason });
      continue;
    }

    samples.push({ lang: language.id, label: language.label, source: outcome.source });
  }

  return { samples, omitted };
}
