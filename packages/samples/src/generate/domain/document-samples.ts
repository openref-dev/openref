/**
 * The transform that puts generated samples on a document, per SPEC 18 and `TX-PAGE-SAMPLES`.
 *
 * WHY A DOCUMENT TRANSFORM AND NOT A RENDERER CHANGE. `CodeSample` already draws a tab strip from
 * `NodeModel.codeSamples`, and `drawnOf` already mounts the `samples` section whenever that list
 * is not empty. What was missing was never markup: it was an `IROperation.codeSamples` that
 * carried anything the document had not written by hand. So the whole of the wiring is filling
 * that field, and the page draws what it always could.
 *
 * THE PROJECTION ARRIVES FROM THE CALLER AND IS NOT REBUILT HERE, which is the one design choice
 * this file makes and the reason is the graph rather than taste. `runnerOperationOf` in
 * `@openref/vue` is the single answer to "which server does this operation use, how does each
 * parameter serialize, which schemes does it require and what does its body editor arrive
 * prefilled with". This package may depend on `core` and `runner` alone, so importing that
 * function is not open to it; deriving the same answers here would be the second derivation its
 * own header refuses, and the day the two disagreed a reader would copy code that goes somewhere
 * the console does not. {@link withGeneratedSamples} therefore takes the projection as a
 * parameter, supplied by a caller that can see it, and this file never decides any of the four.
 *
 * WHAT IT SEEDS THE REQUEST WITH, AND WHERE EACH VALUE COMES FROM. A sample shows values, and an
 * invented value is a lie a reader pastes into a terminal. So a parameter takes the example the
 * document declared, then the one `generateExample` derives from its schema, which is SPEC 5.5's
 * precedence and the order the console's own body prefill uses, and otherwise the parameter is
 * left out of the request entirely. The body takes `exampleText` off the projection, which is
 * that same precedence already applied by the one function that owns it. The credentials are
 * placeholders, per SPEC 19.7: a rendered reference is cached, served and statically built, and a
 * real credential in one is a credential published.
 *
 * AN OPERATION THE RUNNER REFUSES KEEPS THE SAMPLES THE DOCUMENT WROTE, GAINS NONE, AND SAYS SO. A
 * required parameter with nothing to seed it, a path template the operation declares no parameter
 * for, a cookie parameter a browser will not let a script set: each is a request `buildRequest`
 * will not build, and a sample written past that refusal would be code that does not run.
 *
 * WHAT THE FIRST EDITION DID WITH THAT REFUSAL WAS SWALLOW IT, and this paragraph is where the
 * defect lived. The `catch` returned an empty result, so the operation reached the page with no
 * sample, no named language and no reason, `drawnOf` mounted no section, and all fifteen languages
 * vanished with nothing said. That is the fail-open shape this project forbids for anything a
 * reader depends on, and it was reachable from an ordinary OpenAPI document with one cookie
 * parameter in it. The mechanism to say it already existed one line above, as
 * `UNSENDABLE_PLAN_REFUSAL`: a refusal is data, so both the runner's refusal to build and an
 * operation with nowhere to send now travel as `codeSamplesRefused` over every language the caller
 * asked about, and the page prints the reason exactly as it prints every other refusal.
 *
 * EVERY MEMBER IS RECOMPUTED AND EVERY MEMBER IS WRITTEN, INCLUDING WHEN IT IS EMPTY. Until
 * 2026-09-04 the write added a member only where the new list had something in it and spread the
 * old node underneath, so a member this pass computed as empty was not replaced but inherited.
 * Measured on second passes, which SPEC 18 names as a supported path: a document that gained a
 * server drew twelve tabs under a sentence saying all fifteen had refused; a document drawn on all
 * fifteen kept a sentence naming fourteen of them as held back; and a document whose server was
 * taken away kept twelve samples addressed to the origin it no longer declares. The first two are
 * a page contradicting itself in two lines, and the third is a sample that is not the runner's
 * plan, which is the failure this whole section exists to prevent.
 *
 * WHICH REQUIRED KNOWING WHAT THIS PACKAGE WROTE LAST TIME, and `IRCodeSample.generated` is how.
 * Level 3 is whatever is on the operation, so without a mark the twelve samples of the first pass
 * are level 3 to the second, and no recomputation can reach them. With it, each pass composes the
 * document's own samples with a freshly generated set and the fourth defect above cannot arise.
 */

import { compareByCodePoint, finalizeDocument, generateExample, OpenRefError } from '@openref/core';
import type {
  IRCodeSample,
  IRCodeSampleLanguage,
  IRCodeSampleNote,
  IRCodeSampleRefusal,
  IRDocument,
  IRJsonSchema,
  IRJsonValue,
  IROperation,
  IRParameter,
  IRSchemaSlot,
} from '@openref/core';
import type {
  RequestInputs,
  RunnableBodyMediaType,
  RunnableOperation,
  RunnableParameter,
  RunnerBody,
  RunnerValue,
  RunnerValueKind,
} from '@openref/runner';
import { composeCodeSamples } from './compose';
import { generateCodeSamples } from './generate';
import {
  NO_SERVER_REFUSAL,
  PAGE_SAMPLE_LANGUAGES,
  SAMPLE_LANGUAGES,
  UNBUILDABLE_REQUEST_REFUSAL,
  UNREACHABLE_TAB_NOTE,
  unsendableCredentialNote,
} from './languages';
import type { SampleLanguage } from './languages';
import { buildSampleRequest, placeholderCredentials } from './sample-request';
import type { UnsendableScheme } from './sample-request';

/**
 * One media type of a request body, as a projection richer than the runner's own carries it.
 *
 * TWO OPTIONAL MEMBERS ON TOP OF `RunnableBodyMediaType`, AND BOTH ARE READ RATHER THAN DECIDED.
 * `RunnerBodyMediaTypeView` in `@openref/vue` already carries them, so a caller passing
 * `runnerOperationOf`'s result satisfies this without adapting anything; a caller passing a bare
 * {@link RunnableOperation} satisfies it too, and its operations simply get no body in the sample.
 * Declaring them optional here is what lets one function serve both without this package naming a
 * type it is not allowed to import.
 */
export interface SampleBodyMediaType extends RunnableBodyMediaType {
  /** Which of the three editors of SPEC 14.3 this media type is filled in with. */
  readonly editor?: 'text' | 'fields' | 'binary';
  /** What the text editor arrives prefilled with, per SPEC 5.5's precedence. */
  readonly exampleText?: string;
}

/**
 * One parameter, with the cell of the SPEC 14.2 matrix its schema declares.
 *
 * OPTIONAL FOR THE SAME REASON THE TWO BODY MEMBERS ARE. `RunnerParameterView` carries
 * `valueKind` and a bare {@link RunnableParameter} does not, and a caller holding the second is
 * holding a parameter nothing said the shape of. Absent reads as `primitive`, which is the
 * answer `runnerOperationOf` itself gives a parameter with no schema: the one kind that renders
 * as itself at every style and cannot invent structure.
 */
export type SampleParameter = RunnableParameter & {
  readonly valueKind?: RunnerValueKind;
};

/** An operation as the caller's projection describes it, body and value kinds included. */
export interface SampleOperation extends RunnableOperation {
  readonly parameters: readonly SampleParameter[];
  readonly body: readonly SampleBodyMediaType[];
}

/**
 * How a caller turns an IR operation into the description a request is built from.
 *
 * `runnerOperationOf(operation, document)` satisfies this exactly, and satisfying it is the
 * whole contract: no caller is expected to write one.
 */
export type SampleOperationOf = (operation: IROperation, document: IRDocument) => SampleOperation;

/**
 * Puts generated call samples on every HTTP operation of a document.
 *
 * @param document - The normalized document
 * @param operationOf - The projection, `runnerOperationOf` from `@openref/vue`
 * @param languages - Languages the page draws, defaulting to the twelve of SPEC 18 in their
 *   order; the rest of the fifteen are generated and named rather than drawn
 * @returns A new document, hashed and frozen, whose operations carry their samples
 *
 * @example
 * const served = withGeneratedSamples(document, runnerOperationOf);
 */
export function withGeneratedSamples(
  document: IRDocument,
  operationOf: SampleOperationOf,
  languages: readonly SampleLanguage[] = PAGE_SAMPLE_LANGUAGES,
): IRDocument {
  const bodies = schemaBodies(document);
  const nodes = new Map(document.nodes);
  let changed = false;

  // THE CALLER'S LIST IS READ AS A SET, AND SAYING SO COSTS ONE LINE HERE INSTEAD OF A TAB NOBODY
  // CAN REACH. A host that builds its list by concatenation can name a language twice, and two
  // entries under one id produce two samples with one `lang`, of which `CodeSample` can show the
  // first. The first mention keeps its position, because the order of this list is the order of
  // the tabs.
  const drawnLanguages = uniqueLanguages(languages);

  // WHAT IS NOT ON THE PAGE IS DERIVED FROM WHAT IS, AND NEVER WRITTEN OUT BESIDE IT. The caller
  // names one set, the languages the page draws, and the other set is the rest of SPEC 18's
  // fifteen. Two parameters would have let a caller name a page set and a notice set that do not
  // partition the fifteen, and the page would then be able to promise a language nothing writes or
  // to stay silent about one it holds back.
  const elsewhere = SAMPLE_LANGUAGES.filter(
    (language) => !drawnLanguages.some((drawn) => drawn.id === language.id),
  );

  for (const [id, node] of document.nodes) {
    if (node.kind !== 'operation') continue;

    // WHAT THIS PACKAGE WROTE LAST TIME IS NOT AN INPUT TO THIS TIME, and until 2026-09-04 it was.
    // `composeCodeSamples` reads whatever is on the operation as level 3, so a second pass treated
    // the twelve samples the first pass generated as samples an author had typed and kept them
    // whatever the document now said. Measured: a document whose server was removed between the
    // two passes came out with twelve samples still addressed to the origin it no longer declares,
    // which `buildRequest` refuses to build for. The four members below are recomputed from the
    // document's own samples and this request, every pass, which is what makes the second pass a
    // transform rather than an accumulation.
    const declared = (node.codeSamples ?? []).filter((sample) => sample.generated !== true);
    const { drawn, named, refused, notes } = operationSamples(
      node,
      document,
      operationOf,
      bodies,
      drawnLanguages,
      elsewhere,
    );
    const { samples: composed, unreachable } = composeCodeSamples(declared, drawn);

    // A LANGUAGE THE DOCUMENT WROTE ITSELF IS ON THE PAGE, so it is not named as absent from it.
    // Level 3 outranks the generator, and a document that wrote its own Ruby sample has a Ruby tab
    // whichever set this call was given. The same rule governs a refusal: the emitter declining to
    // write a sample says nothing about the one the author wrote by hand.
    const spoken = new Set(composed.map((sample) => sample.lang));
    const missing = named.filter((language) => !spoken.has(language.lang));
    const unable = groupByText(refused.filter((entry) => !spoken.has(entry.lang))).map((group) => ({
      reason: group.text,
      languages: group.languages,
    }));
    // AND A NOTE IS ABOUT A SAMPLE THIS PACKAGE WROTE, WHICH IS THE SAME RULE ONE MORE TIME. A
    // document that wrote its own `shell` sample has a cURL tab whose contents this file never
    // saw, so saying what our cURL emitter's output does with a redirect, or that it carries no
    // credential, would be a sentence about a sample nobody can read. The collision notes are the
    // other way round by construction: those are exactly the document's own entries.
    const written = new Set(declared.map((sample) => sample.lang));
    const noted = groupByText([
      ...collisionNotes(unreachable),
      ...notes.filter((entry) => !written.has(entry.lang)),
    ]).map((group) => ({
      note: group.text,
      languages: group.languages,
    }));

    // THE TEST IS WHETHER THIS PASS SAYS ANYTHING THE NODE DOES NOT ALREADY SAY, and every one of
    // the four is compared by what it holds rather than by how much of it there is. A length was
    // enough while `composeCodeSamples` only appended; it stopped being enough the moment the
    // samples became recomputed, because twelve samples written against one origin and twelve
    // written against another are both twelve. Comparing the sources is what makes a document
    // whose servers moved between two passes come out different, and comparing all four is what
    // keeps a document that did not move come out as the very same object, which is the property
    // both hosts rely on to call this without knowing whether the other ran first.
    const sameSamples = sampleListsAgree(node.codeSamples ?? [], composed);
    const sameNames = languageListsAgree(node.codeSamplesElsewhere ?? [], missing);
    const sameRefusals = groupListsAgree(
      (node.codeSamplesRefused ?? []).map((group) => ({ ...group, text: group.reason })),
      unable.map((group) => ({ ...group, text: group.reason })),
    );
    const sameNotes = groupListsAgree(
      (node.codeSamplesNotes ?? []).map((group) => ({ ...group, text: group.note })),
      noted.map((group) => ({ ...group, text: group.note })),
    );
    if (sameSamples && sameNames && sameRefusals && sameNotes) continue;

    nodes.set(id, sampleFactsOn(node, composed, missing, unable, noted));
    changed = true;
  }

  // NOTHING CHANGED MEANS NOTHING IS REHASHED, and the identity of the document is what says so.
  // An events document has no HTTP operation in it at all, and re-finalizing one would walk and
  // re-freeze a whole IR to arrive at the hash it already carried. It is also what makes the
  // transform idempotent, which is what lets two hosts call it without either having to know
  // whether the other ran first.
  if (!changed) return document;

  // THE HASH IS RETAKEN AND NOT LEFT ALONE, which is the rule `ReferenceService.augment` states
  // in full: the page cache of SPEC 12 is keyed by the document hash, so a document whose content
  // moved under a hash that did not is a cache serving pages from before the move.
  return finalizeDocument({ ...document, nodes, hash: '' });
}

/**
 * Whether two lists of named languages say the same thing, in the same order.
 *
 * ORDER INCLUDED, BECAUSE THE PAGE PRINTS THEM IN IT. Two lists of the same three names in two
 * orders are two sentences, and a transform that called them equal would leave the first order on
 * a document whose second pass produced another.
 *
 * @param left - The list the node already carries
 * @param right - The list this pass produced
 * @returns True when the two are the same names with the same labels in the same order
 */
function languageListsAgree(
  left: readonly IRCodeSampleLanguage[],
  right: readonly IRCodeSampleLanguage[],
): boolean {
  if (left.length !== right.length) return false;

  return left.every((language, index) => {
    const other = right[index];

    return other?.lang === language.lang && other.label === language.label;
  });
}

/**
 * Whether two lists of samples say the same thing, in the same order.
 *
 * THE SOURCE IS COMPARED AND NOT ONLY THE COUNT, which is the whole point of the function. The
 * generated half is rebuilt from the request on every pass, so two lists of twelve are equal in
 * length and unequal in every byte the moment the document's servers, parameters or body moved
 * between the passes. A length told those two apart from nothing, which is how twelve samples
 * addressed to a vanished origin survived a second pass.
 *
 * @param left - The list the node already carries
 * @param right - The list this pass produced
 * @returns True when the two are the same samples in the same order
 */
function sampleListsAgree(left: readonly IRCodeSample[], right: readonly IRCodeSample[]): boolean {
  if (left.length !== right.length) return false;

  return left.every((sample, index) => {
    const other = right[index];

    return (
      other?.lang === sample.lang &&
      other.label === sample.label &&
      other.source === sample.source &&
      other.generated === sample.generated
    );
  });
}

/** One sentence and the languages it is about, as this file carries a group before naming it. */
interface TextGroup {
  readonly text: string;
  readonly languages: readonly IRCodeSampleLanguage[];
}

/**
 * Whether two grouped lists say the same thing, in the same order.
 *
 * ORDER AND GROUPING BOTH, FOR THE REASON {@link languageListsAgree} STATES ABOUT ORDER ALONE. The
 * page prints one sentence per group and the names inside it in order, so two groupings of the
 * same names are two pages, and a transform calling them equal would leave the first on a document
 * whose second pass produced the other.
 *
 * ONE FUNCTION FOR REFUSALS AND NOTES, because the two shapes differ in the name of one field and
 * in nothing a comparison can see. Two copies would be two answers to one question, and the day
 * one of them learned to compare the languages the other would still not.
 *
 * @param left - The list the node already carries
 * @param right - The list this pass produced
 * @returns True when the two are the same sentences over the same languages in the same order
 */
function groupListsAgree(left: readonly TextGroup[], right: readonly TextGroup[]): boolean {
  if (left.length !== right.length) return false;

  return left.every((group, index) => {
    const other = right[index];

    return other?.text === group.text && languageListsAgree(group.languages, other.languages);
  });
}

/**
 * Languages gathered into one entry per sentence, keeping first appearance order.
 *
 * FIRST APPEARANCE DECIDES THE ORDER OF THE GROUPS, and the order inside a group is the order the
 * languages were asked in. Both are the order the page would have met the language in, which is
 * what makes the output deterministic without sorting anything into an order nobody chose.
 *
 * @param entries - One entry per language, in the order the generator answered
 * @returns One entry per distinct sentence
 */
function groupByText(entries: readonly TextedLanguage[]): readonly TextGroup[] {
  const groups = new Map<string, IRCodeSampleLanguage[]>();

  for (const entry of entries) {
    const held = groups.get(entry.text);
    const language = { lang: entry.lang, label: entry.label };

    if (held === undefined) groups.set(entry.text, [language]);
    else held.push(language);
  }

  return [...groups].map(([text, languages]) => ({ text, languages }));
}

/** One language and one sentence about it, before the sentences are gathered into groups. */
interface TextedLanguage extends IRCodeSampleLanguage {
  readonly text: string;
}

/**
 * What the document wrote that the tab strip cannot show, said as a note.
 *
 * THE LABEL IS THE ONE THE DOCUMENT GAVE THE ENTRY THAT LOST, so a reader looking for the tab it
 * names learns which of the two the page kept. Naming the language alone would answer a question
 * nobody asked: the language is on the page, and what is not is this sample.
 *
 * @param unreachable - The declared samples an earlier entry took the language of
 * @returns One entry per unreachable sample, all carrying the one sentence
 */
function collisionNotes(unreachable: readonly IRCodeSample[]): readonly TextedLanguage[] {
  return unreachable.map((sample) => ({
    lang: sample.lang,
    label: sample.label,
    text: UNREACHABLE_TAB_NOTE,
  }));
}

/**
 * The caller's language list read as a set, keeping the position of the first mention.
 *
 * @param languages - The list as the caller wrote it
 * @returns The same list with any later mention of a language removed
 */
function uniqueLanguages(languages: readonly SampleLanguage[]): readonly SampleLanguage[] {
  const seen = new Set<string>();

  return languages.filter((language) => {
    if (seen.has(language.id)) return false;

    seen.add(language.id);

    return true;
  });
}

/**
 * The operation with all four sample members replaced by what this pass computed.
 *
 * A SPREAD OF THE OLD NODE IS NOT A REPLACEMENT, AND THAT WAS THE DEFECT. The write used to add
 * each member only where the new list was non empty, so a spread of the previous node carried the
 * old value forward: a page drew twelve tabs under a sentence saying all fifteen refused, and a
 * page drew fifteen tabs under a sentence naming fourteen of them as held back. The comment above
 * it said the lists were recomputed rather than appended, which was true of the equality test and
 * false of the write. Every member is deleted first, so an empty answer is an answer.
 *
 * EMPTY STILL MEANS ABSENT AND NOT AN EMPTY LIST. Each of the four is documented as absent when
 * there is nothing to say, and a written `[]` says "none" where the type says "nothing to say",
 * in every document every operation of a refused document appears in.
 *
 * @param node - The operation as the document carries it
 * @param samples - The tabs this pass composed
 * @param elsewhere - The languages this pass holds back
 * @param refused - The refusals this pass gathered
 * @param notes - The notes this pass gathered
 * @returns A new operation carrying exactly what this pass computed
 */
function sampleFactsOn(
  node: IROperation,
  samples: readonly IRCodeSample[],
  elsewhere: readonly IRCodeSampleLanguage[],
  refused: readonly IRCodeSampleRefusal[],
  notes: readonly IRCodeSampleNote[],
): IROperation {
  const next: { -readonly [Key in keyof IROperation]: IROperation[Key] } = { ...node };

  delete next.codeSamples;
  delete next.codeSamplesElsewhere;
  delete next.codeSamplesRefused;
  delete next.codeSamplesNotes;

  if (samples.length > 0) next.codeSamples = samples;
  if (elsewhere.length > 0) next.codeSamplesElsewhere = elsewhere;
  if (refused.length > 0) next.codeSamplesRefused = refused;
  if (notes.length > 0) next.codeSamplesNotes = notes;

  return next;
}

/** What one operation gets: the samples the page draws, and the languages it names instead. */
interface OperationSamples {
  readonly drawn: readonly IRCodeSample[];
  /**
   * Languages that produced a sample for this request and are not being drawn.
   *
   * ONLY LANGUAGES WHOSE EMITTER ACTUALLY WROTE SOMETHING, which is what makes the page's sentence
   * true of this operation rather than of the product. An operation with a multipart body gets no
   * entry for the templates that refuse it, because for that request they produce nothing, and a
   * page telling a reader to go and ask for one would be sending them after a refusal.
   */
  readonly named: readonly IRCodeSampleLanguage[];
  /**
   * Languages that wrote nothing for this request, whether the page draws them or not.
   *
   * BOTH SETS AND NOT ONLY THE DRAWN ONE. A language of the three is absent from the page's first
   * sentence exactly when it refused, and that absence reads the same as never having existed; so
   * the refusal is stated for the three as it is for the twelve, and the three answers together
   * account for every language the caller asked about.
   */
  readonly refused: readonly TextedLanguage[];
  /**
   * What is true of the samples that were produced, whether the page draws them or not.
   *
   * ORTHOGONAL TO THE THREE ABOVE, WHICH IS WHY IT IS A FOURTH MEMBER AND NOT A FOURTH BUCKET. The
   * first three partition the languages; this one says something about the ones that ended up with
   * a sample. Both of its sources were already computed before 2026-09-04 and neither reached a
   * reader: `GeneratedSamples.notes` carries the redirect divergence of four clients, and
   * `PlaceholderCredentials.unsendable` carries a credential no request can hold at all.
   */
  readonly notes: readonly TextedLanguage[];
}

/**
 * Every language the caller asked about, refused for the one reason they all share.
 *
 * ONE REASON OVER FIFTEEN NAMES RATHER THAN NOTHING AT ALL. Neither of the two refusals this
 * answers is a language's: one is the runner declining to build the request and the other is an
 * operation with nowhere to send, so every emitter is unreachable for the same reason and
 * {@link groupByText} folds them into the one sentence the page prints.
 *
 * THE DRAWN SET COMES FIRST, which is the order the page would have met the languages in and the
 * order every other refusal is listed in.
 *
 * @param languages - Languages the page draws
 * @param elsewhere - Languages the page names rather than draws
 * @param reason - Why none of them could write anything
 * @returns Nothing drawn, nothing held back, and all fifteen accounted for
 */
function allRefused(
  languages: readonly SampleLanguage[],
  elsewhere: readonly SampleLanguage[],
  reason: string,
): OperationSamples {
  return {
    drawn: [],
    named: [],
    refused: [...languages, ...elsewhere].map((language) => ({
      lang: language.id,
      label: language.label,
      text: reason,
    })),
    // NO NOTE WHERE THERE IS NO SAMPLE. A note says something about a sample a reader can read, so
    // an operation with none has nothing for one to be about, and a credential sentence beside no
    // tab at all would be answering a question the refusal above already closed.
    notes: [],
  };
}

/**
 * The samples one operation gets, or a refusal over every language when the request cannot be built.
 *
 * @param operation - The operation as the IR carries it
 * @param document - The document it belongs to
 * @param operationOf - The caller's projection
 * @param bodies - Normalized named schemas, for `generateExample`
 * @param languages - Languages to write onto the page
 * @param elsewhere - Languages to generate and name rather than draw
 * @returns The generated samples and the named languages, or every language refused with the reason
 */
function operationSamples(
  operation: IROperation,
  document: IRDocument,
  operationOf: SampleOperationOf,
  bodies: ReadonlyMap<string, IRJsonSchema>,
  languages: readonly SampleLanguage[],
  elsewhere: readonly SampleLanguage[],
): OperationSamples {
  const run = operationOf(operation, document);

  // AN OPERATION WITH NOWHERE TO SEND HAS NO SAMPLE AND SAYS WHY, and the refusal is here rather
  // than at `buildRequest` so the reason is nameable. A normalized OpenAPI document always has at
  // least the specification's own default server, so this is the hand built document and the merged
  // one whose service declared none; writing a sample against an invented origin would be the class
  // of guess CLAUDE.md's fifth lesson forbids. Returning nothing at all, which is what this line
  // did until 2026-09-03, is the other forbidden answer: it makes the page silent about fifteen
  // languages, and a silence is what a reader cannot tell from a reference that has no samples.
  const serverUrl = run.servers[0];
  if (serverUrl === undefined) return allRefused(languages, elsewhere, NO_SERVER_REFUSAL);

  try {
    // BOTH HALVES OF THE ANSWER ARE READ, AND THE SECOND WAS DISCARDED UNTIL 2026-09-04.
    // `placeholderCredentials` returns the schemes whose credential no request can carry, and
    // dropping it meant a mutualTLS operation drew twelve samples that cannot authenticate with
    // nothing said about why. Measured on such an operation: twelve drawn, three named, no
    // refusal, and not one word about the credential.
    const { values, unsendable } = placeholderCredentials(run.security);
    const request = buildSampleRequest(
      run,
      requestInputs(operation, run, bodies, serverUrl),
      values,
    );

    // ONE GENERATOR CALL OVER BOTH SETS, so the two answers come from one pass over one request.
    // Asking twice would run the shared refusals of `generateCodeSamples`, the unsendable plan and
    // the non-ASCII header, twice over one plan, and would let the two answers be taken from two
    // builds of it the day anything above became less than deterministic.
    //
    // THE THIRD ANSWER IS READ TOO, AND IT WAS THROWN AWAY FOR AS LONG AS IT EXISTED. `notes`
    // carries the redirect divergence measured on cURL, HTTPie, PowerShell and Swift; the caller
    // destructured two of the three members, so a reader was never told that four of their twelve
    // tabs behave unlike the button once the response is a 302.
    const {
      samples: produced,
      omitted,
      notes,
    } = generateCodeSamples(request, [...languages, ...elsewhere]);
    const held = new Set<string>(elsewhere.map((language) => language.id));

    return {
      // MARKED AS THIS PACKAGE'S, so the next pass can tell them from what an author wrote and
      // rebuild them against whatever the document says then.
      drawn: produced
        .filter((sample) => !held.has(sample.lang))
        .map((sample) => ({ ...sample, generated: true as const })),
      named: produced
        .filter((sample) => held.has(sample.lang))
        .map((sample) => ({ lang: sample.lang, label: sample.label })),
      refused: omitted.map((entry) => ({
        lang: entry.lang,
        label: entry.label,
        text: entry.reason,
      })),
      notes: [
        ...notes.map((entry) => ({ lang: entry.lang, label: entry.label, text: entry.note })),
        ...credentialNotes(produced, unsendable),
      ],
    };
  } catch (cause) {
    // ONLY THE RUNNER'S OWN REFUSALS ARE ANSWERED HERE. `SerializationError` and `AuthError` both
    // extend `OpenRefError` and both mean "this request cannot be built", which is an answer.
    // Anything else is a defect in this file or below it and travels, because a transform that
    // swallowed a `TypeError` would serve a reference silently missing every sample.
    //
    // AND AN ANSWER IS CARRIED RATHER THAN ABSORBED, WHICH IS THE HALF THIS LINE USED TO GET WRONG.
    // Returning an empty result turned a refusal with a sentence on it into no section, no tab and
    // no reason. The runner's own message is appended, so the page states the refusal the runner
    // actually made rather than a paraphrase kept in this file and drifting from it.
    if (cause instanceof OpenRefError) {
      return allRefused(
        languages,
        elsewhere,
        `${UNBUILDABLE_REQUEST_REFUSAL} The runner said: ${cause.message}`,
      );
    }

    throw cause;
  }
}

/**
 * The credential this operation needs and no sample carries, said over every language that has one.
 *
 * THE FACT IS ABOUT THE REQUEST AND NOT ABOUT ANY CLIENT, so it is stated over every language that
 * produced a sample, which is the same shape {@link allRefused} uses for the two request level
 * refusals. Naming one language would suggest the others are fine.
 *
 * NOT A REFUSAL, WHICH IS THE DECISION THIS FUNCTION MAKES. Each sample sends exactly what the
 * console sends, and the console cannot carry the credential either, per SPEC 19.7; refusing here
 * would take fifteen faithful tabs off every operation behind a client certificate. What a reader
 * gets instead is the tab and the sentence.
 *
 * @param produced - The samples the generator wrote, in the order it wrote them
 * @param unsendable - Schemes whose credential a request cannot carry, from `placeholderCredentials`
 * @returns One entry per language per scheme, or nothing when every credential can travel
 */
function credentialNotes(
  produced: readonly IRCodeSample[],
  unsendable: readonly UnsendableScheme[],
): readonly TextedLanguage[] {
  return unsendable.flatMap((scheme) =>
    produced.map((sample) => ({
      lang: sample.lang,
      label: sample.label,
      text: unsendableCredentialNote(scheme.schemeId, scheme.cause),
    })),
  );
}

/**
 * What the reader would have typed, as the console would pass it.
 *
 * @param operation - The operation as the IR carries it, for the examples it declares
 * @param run - The projection, for the value kind and the body prefill
 * @param bodies - Normalized named schemas, for `generateExample`
 * @param serverUrl - The server the sample is written against
 * @returns The inputs `buildRequest` reads
 */
function requestInputs(
  operation: IROperation,
  run: SampleOperation,
  bodies: ReadonlyMap<string, IRJsonSchema>,
  serverUrl: string,
): RequestInputs {
  const declared = new Map(operation.parameters.map((parameter) => [key(parameter), parameter]));
  const values: Record<string, RunnerValue> = {};

  for (const parameter of run.parameters) {
    const source = declared.get(key(parameter));
    if (source === undefined) continue;

    const seed = seedValue(source, bodies);
    if (seed === undefined) continue;

    values[key(parameter)] = typedValue(parameter.valueKind ?? 'primitive', seed);
  }

  // THE FIRST MEDIA TYPE, WHICH IS THE ONE THE CONSOLE DEFAULTS TO. `resolveBody` takes the first
  // declared type when the inputs name none, and the normalizer sorts a content map by code
  // point, so the sample and the button agree on which body they are about without either of them
  // choosing it.
  const media = run.body[0];
  const exampleText = media?.exampleText;

  // THE BODY IS BUILT AS ITS OWN ANNOTATED VALUE AND NOT INSIDE THE SPREAD, and the reason is a
  // defect this file already had once: a conditional spread into an object literal is not checked
  // against the return type member by member, so a wrong `text` reached `resolveBody` and failed
  // at run time rather than at compile time. Naming the type here is what makes it a compile error.
  const body: RunnerBody | undefined =
    exampleText === undefined ? undefined : { kind: 'text', text: exampleText };

  return {
    values,
    serverUrl,
    ...(media === undefined || body === undefined ? {} : { body, mediaType: media.mediaType }),
  };
}

/** Where a value is kept, matching what the runner reads. */
function key(parameter: { readonly in: string; readonly name: string }): string {
  return `${parameter.in}:${parameter.name}`;
}

/**
 * The example one parameter is seeded from, by SPEC 5.5's precedence.
 *
 * THE DECLARED VALUE FIRST, `example` AHEAD OF THE `examples` MAP, which is OpenAPI's own order,
 * and a map contributes its first member by code point rather than the order a document happened
 * to list them in. Then the schema's generated example. Then nothing, and nothing is a real
 * answer: the parameter is left out of the request and the sample does not mention it.
 *
 * `null` IS READ AS NOTHING RATHER THAN AS A VALUE. `generateExample` returns it for a type it
 * cannot see, its own header says so, and a sample carrying `?q=null` because a `$ref` did not
 * resolve is exactly the invented value this file exists not to write.
 *
 * @param parameter - The parameter as the document declares it
 * @param bodies - Normalized named schemas, so a named slot resolves
 * @returns The value to seed with, or undefined when there is none
 */
function seedValue(
  parameter: IRParameter,
  bodies: ReadonlyMap<string, IRJsonSchema>,
): IRJsonValue | undefined {
  if (parameter.example !== undefined && parameter.example !== null) return parameter.example;

  const named = Object.keys(parameter.examples ?? {}).sort(compareByCodePoint)[0];
  const first = named === undefined ? undefined : parameter.examples?.[named]?.value;
  if (first !== undefined && first !== null) return first;

  const schema = parameter.schema === undefined ? undefined : resolve(parameter.schema, bodies);
  if (schema === undefined) return undefined;

  return generateExample(schema, { schemas: bodies, view: 'request' }) ?? undefined;
}

/**
 * From a JSON value to the cell of the SPEC 14.2 matrix the parameter declares.
 *
 * THE KIND IS THE DOCUMENT'S ANSWER AND NOT THE VALUE'S SHAPE, which is the rule `TryItPanel`
 * states where it turns a field's text into the same type: a console field is text whatever the
 * value looks like, and which cell it lands in comes from the schema. Reading the shape here
 * instead would send an array parameter whose example is a single string as a primitive, which
 * serializes through a different column of the matrix than the button uses.
 *
 * @param kind - What the projection says the parameter's schema declares
 * @param value - The example
 * @returns The typed value
 */
function typedValue(kind: RunnerValueKind, value: IRJsonValue): RunnerValue {
  if (kind === 'array') {
    return { kind: 'array', value: (Array.isArray(value) ? value : [value]).map(text) };
  }

  if (kind === 'object') {
    const entries =
      typeof value === 'object' && value !== null && !Array.isArray(value)
        ? Object.entries(value)
        : [];

    return {
      kind: 'object',
      value: entries.map(([name, member]) => [name, text(member)] as const),
    };
  }

  return { kind: 'primitive', value: text(value) };
}

/**
 * One JSON value as the text a reader would have in the field.
 *
 * A string is itself, because a field holds text and quoting it would send the quotes. Everything
 * else prints as the JSON it is, which is what a reader typing a number or a nested object into a
 * text field would produce. `undefined` cannot arrive: {@link IRJsonValue} does not admit it, and
 * that is what makes `JSON.stringify` total here.
 */
function text(value: IRJsonValue): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/** Resolves a schema slot against the document's named schemas. */
function resolve(
  slot: IRSchemaSlot,
  bodies: ReadonlyMap<string, IRJsonSchema>,
): IRJsonSchema | undefined {
  return slot.kind === 'named' ? bodies.get(slot.schemaId) : slot.schema.normalized;
}

/**
 * The document's named schemas, reduced to the normalized bodies `generateExample` follows.
 *
 * BUILT ONCE PER DOCUMENT AND NOT ONCE PER OPERATION. `stripe.yaml` carries 1,440 named schemas
 * and 589 operations, and rebuilding the map inside the loop would walk the first list once for
 * every member of the second.
 */
function schemaBodies(document: IRDocument): ReadonlyMap<string, IRJsonSchema> {
  const bodies = new Map<string, IRJsonSchema>();

  for (const [id, entry] of document.schemas) {
    if (entry.normalized !== undefined) bodies.set(id, entry.normalized);
  }

  return bodies;
}
