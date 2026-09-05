/**
 * The generator, per SPEC 18: one request in, up to fifteen samples out, plus the languages that
 * could not write it and why.
 *
 * THE OMISSIONS ARE RETURNED RATHER THAN SWALLOWED. A generator that quietly produced six samples
 * where fifteen were asked for would leave a caller unable to tell "this language has nothing to say
 * about this request" from "the generator is broken", which is the shape of defect CLAUDE.md's
 * fifth lesson is about. The list is data, so a doctor rule or a page can print it.
 *
 * THE EMITTER TABLE IS A TOTAL RECORD over {@link SampleLanguageId}, so a sixteenth language is a
 * compile error here rather than a tab that renders nothing.
 */

import type { IRCodeSample } from '@openref/core';
import { emitCurl } from './emit-curl';
import { emitFetch } from './emit-fetch';
import { emitHttpx } from './emit-httpx';
import {
  emitCsharp,
  emitDart,
  emitGo,
  emitJava,
  emitKotlin,
  emitPhp,
  emitRuby,
  emitRust,
  emitSwift,
} from './emit-templates';
import { emitHttpie, emitPowerShell, emitWget } from './emit-tools';
import {
  LINE_COMMENT,
  NON_ASCII_HEADER_REFUSAL,
  REDIRECT_CREDENTIAL_DROPPED_NOTE,
  REDIRECT_NOT_FOLLOWED_NOTE,
  RELATIVE_ADDRESS_NOTE,
  RELATIVE_ADDRESS_SHELL_NOTE,
  SAMPLE_LANGUAGES,
} from './languages';
import type { EmitOutcome, SampleLanguage, SampleLanguageId } from './languages';
import { isOriginRelative, nonAsciiHeaderNames, unsendablePlanReason } from './plan-parts';
import type { SampleRequest } from './sample-request';

/**
 * The languages measured to put the runner's own octets on the wire for a non-ASCII header value.
 *
 * A SHORT LIST BECAUSE IT IS A LIST OF MEASUREMENTS AND NOT OF OPINIONS. `fetch` in Node, which is
 * what the TypeScript sample runs on and what the runner itself uses, and `URLSession` both emitted
 * the single octet `0xE9` for `café` on 2026-09-03. Every other client either emitted the UTF-8
 * pair or refused outright, and the nine that cannot be run here were not measured at all, which is
 * the same answer for the purpose of this list: not proved to match.
 */
const NON_ASCII_HEADER_CAPABLE: readonly SampleLanguageId[] = ['typescript', 'swift'];

/** The three whose address `shellUrl` completes with an environment variable. */
const SHELL_LANGUAGES: readonly SampleLanguageId[] = ['shell', 'bash', 'sh'];

/**
 * The comment a sample carries when the document named no origin to send to.
 *
 * IT IS DECIDED ONCE PER REQUEST AND WRITTEN INTO EVERY SAMPLE, in the language's own comment
 * syntax, because the copy control copies the source and nothing else. The three shells get a
 * second line naming the variable their command already reads, so a reader who copies a cURL line
 * has, in one paste, the command, the reason it needs a value, and the value's name.
 *
 * @param language - The language the sample is written in
 * @returns The comment lines, ending in a newline, or the empty string
 */
function addressComment(language: SampleLanguage): string {
  const mark = LINE_COMMENT[language.id];
  const lines = [`${mark} ${RELATIVE_ADDRESS_NOTE}`];

  if (SHELL_LANGUAGES.includes(language.id)) lines.push(`${mark} ${RELATIVE_ADDRESS_SHELL_NOTE}`);

  return `${lines.join('\n')}\n`;
}

/** Per language, what it does with a redirect where that differs from the console. */
const REDIRECT_NOTES: Partial<Readonly<Record<SampleLanguageId, string>>> = {
  shell: REDIRECT_NOT_FOLLOWED_NOTE,
  bash: REDIRECT_NOT_FOLLOWED_NOTE,
  powershell: REDIRECT_CREDENTIAL_DROPPED_NOTE,
  swift: REDIRECT_CREDENTIAL_DROPPED_NOTE,
};

/** One language that produced no sample for this request, with the reason it gave. */
export interface SampleOmission {
  readonly lang: SampleLanguageId;
  /** What the tab would have said, so a caller can name the language a reader would look for. */
  readonly label: string;
  readonly reason: string;
}

/** One language whose sample is correct and whose client behaves unlike the console anyway. */
export interface SampleNote {
  readonly lang: SampleLanguageId;
  /** What the tab says, so a caller can name the tab the note belongs beside. */
  readonly label: string;
  readonly note: string;
}

/**
 * What the generator produced, what it did not, and what a reader should know about what it did.
 *
 * `notes` IS THE THIRD ANSWER AND IT IS NOT A WEAKER `omitted`. An omission says the sample would
 * have sent something other than the plan. A note says the sample sends exactly the plan and the
 * client then behaves unlike the console afterwards, which is true of a redirect and of nothing
 * else measured so far. Folding the two together would either hide a real divergence or refuse
 * four tabs that are correct.
 */
export interface GeneratedSamples {
  readonly samples: readonly IRCodeSample[];
  readonly omitted: readonly SampleOmission[];
  readonly notes: readonly SampleNote[];
}

/** Every emitter, keyed by the language it writes. */
const EMITTERS: Readonly<Record<SampleLanguageId, (request: SampleRequest) => EmitOutcome>> = {
  shell: emitCurl,
  bash: emitHttpie,
  sh: emitWget,
  powershell: emitPowerShell,
  typescript: emitFetch,
  python: emitHttpx,
  go: emitGo,
  php: emitPhp,
  java: emitJava,
  csharp: emitCsharp,
  ruby: emitRuby,
  rust: emitRust,
  swift: emitSwift,
  kotlin: emitKotlin,
  dart: emitDart,
};

/**
 * Generates the samples for one request.
 *
 * @param request - The request the runner would send, from `buildSampleRequest`
 * @param languages - Languages to write, defaulting to all fifteen of SPEC 18 in their order
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
  const notes: SampleNote[] = [];

  // TWO REFUSALS BELONG TO THE REQUEST RATHER THAN TO ANY CLIENT, so they are decided once here
  // instead of fifteen times below. The first is a plan the runner will not send at all; the
  // second is a header value whose octets depend on who writes them.
  const unsendable = unsendablePlanReason(request);
  const nonAscii = nonAsciiHeaderNames(request);
  // THE THIRD REQUEST LEVEL FACT, AND THE ONLY ONE THAT IS NOT A REFUSAL. An address with no
  // origin is a request that is completely known except for one value the reader holds and this
  // package does not, so every sample says so in its own comment syntax and the three shells read
  // the value from an environment variable rather than refusing or inventing a host.
  const relative = isOriginRelative(request.plan.url);

  for (const language of languages) {
    const refusal =
      unsendable ??
      (nonAscii.length > 0 && !NON_ASCII_HEADER_CAPABLE.includes(language.id)
        ? NON_ASCII_HEADER_REFUSAL
        : null);

    const outcome: EmitOutcome =
      refusal === null ? EMITTERS[language.id](request) : { kind: 'refused', reason: refusal };

    if (outcome.kind === 'refused') {
      omitted.push({ lang: language.id, label: language.label, reason: outcome.reason });
      continue;
    }

    samples.push({
      lang: language.id,
      label: language.label,
      source: relative ? `${addressComment(language)}${outcome.source}` : outcome.source,
    });

    const note = REDIRECT_NOTES[language.id];
    if (note !== undefined) notes.push({ lang: language.id, label: language.label, note });
  }

  return { samples, omitted, notes };
}
