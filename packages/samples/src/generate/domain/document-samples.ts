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
 * AN OPERATION THE RUNNER REFUSES KEEPS THE SAMPLES THE DOCUMENT WROTE AND GAINS NONE. A required
 * parameter with nothing to seed it, a path template the operation declares no parameter for, a
 * cookie parameter a browser will not let a script set: each is a request `buildRequest` will not
 * build, and a sample written past that refusal would be code that does not run. The operation
 * ends up as an operation nobody wrote a sample for, which is a state the page already draws
 * correctly, rather than as a boot failure or as fifteen samples of a request the console rejects.
 */

import { compareByCodePoint, finalizeDocument, generateExample, OpenRefError } from '@openref/core';
import type {
  IRCodeSample,
  IRCodeSampleLanguage,
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
import { PAGE_SAMPLE_LANGUAGES, SAMPLE_LANGUAGES } from './languages';
import type { SampleLanguage } from './languages';
import { buildSampleRequest, placeholderCredentials } from './sample-request';

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

  // WHAT IS NOT ON THE PAGE IS DERIVED FROM WHAT IS, AND NEVER WRITTEN OUT BESIDE IT. The caller
  // names one set, the languages the page draws, and the other set is the rest of SPEC 18's
  // fifteen. Two parameters would have let a caller name a page set and a notice set that do not
  // partition the fifteen, and the page would then be able to promise a language nothing writes or
  // to stay silent about one it holds back.
  const elsewhere = SAMPLE_LANGUAGES.filter(
    (language) => !languages.some((drawn) => drawn.id === language.id),
  );

  for (const [id, node] of document.nodes) {
    if (node.kind !== 'operation') continue;

    const { drawn, named } = operationSamples(
      node,
      document,
      operationOf,
      bodies,
      languages,
      elsewhere,
    );
    const composed = composeCodeSamples(node.codeSamples, drawn);

    // A LANGUAGE THE DOCUMENT WROTE ITSELF IS ON THE PAGE, so it is not named as absent from it.
    // Level 3 outranks the generator, and a document that wrote its own Ruby sample has a Ruby tab
    // whichever set this call was given.
    const spoken = new Set(composed.map((sample) => sample.lang));
    const missing = named.filter((language) => !spoken.has(language.lang));

    // THE TEST IS WHETHER ANYTHING WAS ADDED, AND A LENGTH IS EXACTLY THAT TEST for the samples,
    // because `composeCodeSamples` only ever appends to what the document wrote. Two operations
    // reach this line having gained nothing: one the generator refused, and one whose document
    // already wrote every language the generator would have. Both keep the node they had.
    //
    // THE SECOND HALF IS NOT A LENGTH AND THE FIRST EDITION OF IT WAS, WHICH BROKE IDEMPOTENCE.
    // The named languages are recomputed from the request every pass rather than appended to what
    // is there, so `missing.length > 0` is true on the second application as much as on the first,
    // and the transform re-finalized a document it had not changed. A caller applying it twice got
    // two equal documents that are not the same object, which is exactly the property the two
    // hosts rely on to call it without knowing whether the other ran first. The test is therefore
    // whether the names moved, not whether there are any.
    const sameSamples = composed.length === (node.codeSamples?.length ?? 0);
    const sameNames = languageListsAgree(node.codeSamplesElsewhere ?? [], missing);
    if (sameSamples && sameNames) continue;

    nodes.set(id, {
      ...node,
      codeSamples: composed,
      ...(missing.length === 0 ? {} : { codeSamplesElsewhere: missing }),
    });
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
  return (
    left.length === right.length &&
    left.every(
      (language, index) =>
        language.lang === right[index]?.lang && language.label === right[index]?.label,
    )
  );
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
}

/** Nothing at all: no sample to draw and no language to name. */
const NO_SAMPLES: OperationSamples = { drawn: [], named: [] };

/**
 * The samples one operation gets, or none when the request cannot be built.
 *
 * @param operation - The operation as the IR carries it
 * @param document - The document it belongs to
 * @param operationOf - The caller's projection
 * @param bodies - Normalized named schemas, for `generateExample`
 * @param languages - Languages to write onto the page
 * @param elsewhere - Languages to generate and name rather than draw
 * @returns The generated samples and the named languages, both empty when no request can be built
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

  // AN OPERATION WITH NOWHERE TO SEND HAS NO SAMPLE, and the refusal is here rather than at
  // `buildRequest` so the reason is nameable. A normalized OpenAPI document always has at least
  // the specification's own default server, so this is the hand built document and the merged one
  // whose service declared none; writing a sample against an invented origin would be the class
  // of guess CLAUDE.md's fifth lesson forbids.
  const serverUrl = run.servers[0];
  if (serverUrl === undefined) return NO_SAMPLES;

  try {
    const { values } = placeholderCredentials(run.security);
    const request = buildSampleRequest(
      run,
      requestInputs(operation, run, bodies, serverUrl),
      values,
    );

    // ONE GENERATOR CALL OVER BOTH SETS, so the two answers come from one pass over one request.
    // Asking twice would run the shared refusals of `generateCodeSamples`, the unsendable plan and
    // the non-ASCII header, twice over one plan, and would let the two answers be taken from two
    // builds of it the day anything above became less than deterministic.
    const produced = generateCodeSamples(request, [...languages, ...elsewhere]).samples;
    const held = new Set<string>(elsewhere.map((language) => language.id));

    return {
      drawn: produced.filter((sample) => !held.has(sample.lang)),
      named: produced
        .filter((sample) => held.has(sample.lang))
        .map((sample) => ({ lang: sample.lang, label: sample.label })),
    };
  } catch (cause) {
    // ONLY THE RUNNER'S OWN REFUSALS ARE ABSORBED. `SerializationError` and `AuthError` both
    // extend `OpenRefError` and both mean "this request cannot be built", which is an answer.
    // Anything else is a defect in this file or below it and travels, because a transform that
    // swallowed a `TypeError` would serve a reference silently missing every sample.
    if (cause instanceof OpenRefError) return NO_SAMPLES;

    throw cause;
  }
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
