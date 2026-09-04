/**
 * The fifteen languages of SPEC 18, and the two levels the specification splits them into.
 *
 * LEVEL 1 IS THIS PROJECT'S OWN GENERATOR AND LEVEL 2 IS A TEMPLATE, and the difference is not a
 * quality ranking, it is who wrote the emitter. Level 1 renders the request from the plan itself
 * and may refuse one shape it cannot spell; level 2 renders a text body and refuses a byte one,
 * because nine hand written multipart encoders would put nine untested body builders into the one
 * place SPEC 18 exists to keep a single answer. A refusal a caller can read is the T050 rule about
 * an annotated payload applied to a language: a sample may show what the document declares and no
 * more.
 *
 * LEVEL 1 DOES NOT MEAN "REFUSES NOTHING", AND SAYING SO WOULD BE FALSE ABOUT cURL FIRST OF ALL.
 * `emit-curl.ts` has refused a multipart field whose name carries `=` since T059, because curl
 * reads that character as the end of the name. The three command line tools of this revision refuse
 * by the same rule and for reasons taken off a live server rather than off a manual.
 *
 * THE IDS ARE HIGHLIGHTER IDS AND NOT PRODUCT NAMES. `IRCodeSample.lang` reaches
 * `markdown.renderCode` on the server, which passes it to the highlighter, so `csharp` and not
 * `C#`; the product name is the label, which is what the tab says.
 *
 * FOUR COMMAND LINE TOOLS SHARE ONE GRAMMAR AND THEREFORE TAKE FOUR IDS, which is a cost this file
 * pays rather than a discovery. `CodeSample` finds the active tab by `lang` and keys the list by
 * it, so two entries carrying one id make the second unreachable; `shell`, `bash` and `sh` are
 * three shiki aliases of one grammar and are spent here on the tab key. The consequence is named in
 * SPEC 18: a document writing its own `bash` sample puts out the HTTPie tab, exactly as a document
 * writing `shell` already puts out cURL. The clean answer is a tab identity of its own on
 * `IRCodeSample`, which is frozen public API and therefore not this revision's to change.
 */

import type { UnsendableCause } from '@openref/core';

/** Language ids, spelled as the highlighter spells them. */
export type SampleLanguageId =
  | 'shell'
  | 'bash'
  | 'sh'
  | 'powershell'
  | 'typescript'
  | 'python'
  | 'go'
  | 'php'
  | 'java'
  | 'csharp'
  | 'ruby'
  | 'rust'
  | 'swift'
  | 'kotlin'
  | 'dart';

/** Which of the two generators of SPEC 18 produces a language. */
export type SampleLevel = 1 | 2;

/**
 * Where a language's sample is carried, per the maintainer's ruling of 2026-09-03.
 *
 * TWO PLACEMENTS AND NOT TWO QUALITIES. Every one of the fifteen is generated, tested and
 * reachable; what the placement decides is whether the reference page carries the tab inline or
 * whether a caller asks for it. `page` is the twelve the page draws; `elsewhere` is the three it
 * names instead, and the page says their names rather than dropping them, because a reader has to
 * be able to tell a language this reference does not have from a language it can produce.
 *
 * THE THREE ARE THE THREE MOST EXPENSIVE AND THAT IS THE WHOLE CRITERION. Measured on the runner,
 * Ruby 3,122, Java 2,726 and PHP 2,374 bytes of one page against 15,435 for all fifteen: 53 percent
 * of the sample cost in three of the fifteen tabs. They are expensive by highlighting rather than
 * by source length, since `HIGHLIGHT_LANGUAGES` carries all three grammars and their source
 * therefore travels as markup. The figures are in SPEC 18 beside the list, with the machine.
 */
export type SamplePlacement = 'page' | 'elsewhere';

/** One language a sample can be written in. */
export interface SampleLanguage {
  readonly id: SampleLanguageId;
  /** What the tab says. */
  readonly label: string;
  readonly level: SampleLevel;
  /**
   * Whether the reference page carries this tab inline.
   *
   * REQUIRED RATHER THAN OPTIONAL, so a sixteenth language cannot be added without somebody
   * deciding what a page does with it. An optional member defaulting to `page` would have made
   * "nobody decided" and "the page carries it" the same state.
   */
  readonly placement: SamplePlacement;
}

/**
 * The fifteen, in the order SPEC 18 lists them.
 *
 * The order is the order the tabs appear in, so it is behaviour rather than presentation. The four
 * command line tools come first and cURL first among them, because a reader checking what a request
 * looks like reads a command; the two scripting languages follow; the templates come last, because
 * a reader who wants their own language goes looking for its name rather than reading down. cURL
 * stays at the head of the list, so the tab a page opens on has not moved.
 *
 * THE ORDER IS NOT DISTURBED BY THE PLACEMENT, WHICH IS WHY THE THREE ARE LEFT WHERE THEY WERE.
 * PHP, Java and Ruby sit among the templates in the position SPEC 18 gives them, and
 * {@link PAGE_SAMPLE_LANGUAGES} is this list with three entries taken out rather than a list of
 * twelve written in some order of its own. Moving them to the end would have made two orders where
 * the section states one.
 */
export const SAMPLE_LANGUAGES: readonly SampleLanguage[] = [
  { id: 'shell', label: 'cURL', level: 1, placement: 'page' },
  { id: 'bash', label: 'HTTPie', level: 1, placement: 'page' },
  { id: 'sh', label: 'wget', level: 1, placement: 'page' },
  { id: 'powershell', label: 'PowerShell', level: 1, placement: 'page' },
  { id: 'typescript', label: 'TypeScript', level: 1, placement: 'page' },
  { id: 'python', label: 'Python', level: 1, placement: 'page' },
  { id: 'go', label: 'Go', level: 2, placement: 'page' },
  { id: 'php', label: 'PHP', level: 2, placement: 'elsewhere' },
  { id: 'java', label: 'Java', level: 2, placement: 'elsewhere' },
  { id: 'csharp', label: 'C#', level: 2, placement: 'page' },
  { id: 'ruby', label: 'Ruby', level: 2, placement: 'elsewhere' },
  { id: 'rust', label: 'Rust', level: 2, placement: 'page' },
  { id: 'swift', label: 'Swift', level: 2, placement: 'page' },
  { id: 'kotlin', label: 'Kotlin', level: 2, placement: 'page' },
  { id: 'dart', label: 'Dart', level: 2, placement: 'page' },
];

/**
 * The twelve tabs the reference page draws, in the order of {@link SAMPLE_LANGUAGES}.
 *
 * DERIVED AND NOT WRITTEN OUT, because two hand written lists that have to agree are the shape
 * this project has now been caught by more than once. There is one list of languages and one
 * member on each that decides where it is drawn; these two are that member read twice.
 */
export const PAGE_SAMPLE_LANGUAGES: readonly SampleLanguage[] = SAMPLE_LANGUAGES.filter(
  (language) => language.placement === 'page',
);

/**
 * The three the page names instead of carrying, in the order of {@link SAMPLE_LANGUAGES}.
 *
 * NOT "UNSUPPORTED" AND NOT "OMITTED". The generator writes them, the emitters are the same
 * emitters, and `withGeneratedSamples` produces them for any caller that asks for them by passing
 * them in. What this list is, is the answer the page gives a reader looking for Ruby: this
 * reference writes Ruby, and this page is not carrying it.
 */
export const OFF_PAGE_SAMPLE_LANGUAGES: readonly SampleLanguage[] = SAMPLE_LANGUAGES.filter(
  (language) => language.placement === 'elsewhere',
);

/**
 * What an emitter answers with: the sample, or the reason there is none.
 *
 * NO THIRD MEMBER, AND IN PARTICULAR NOT A SAMPLE WITH A HOLE IN IT. A template that printed a
 * comment where the multipart body belongs would be code a reader copies, runs and watches fail,
 * with the generator having said nothing.
 */
export type EmitOutcome =
  | { readonly kind: 'source'; readonly source: string }
  | { readonly kind: 'refused'; readonly reason: string };

/** The reason every level 2 template gives for the one body shape it cannot write. */
export const BYTE_BODY_REFUSAL =
  'the request body is bytes, which this template renders no encoder for; the cURL, TypeScript ' +
  'and Python samples carry it';

/**
 * Why HTTPie cannot be told to send a header whose name carries one of its own separators.
 *
 * MEASURED AGAINST THE REAL BINARY ON 2026-09-03, HTTPie 3.2.4, not read off its manual. A header
 * argument spelled `X-A=B:v` reached the server as the body `{"X-A": "B:v"}` under a
 * `Content-Type: application/json` HTTPie chose itself, with no such header on the request at all;
 * `X-A@B:v` ended the process with status 1 and sent nothing. The first of those is the failure
 * SPEC 18 forbids by name, a command that looks right and sends something else.
 *
 * THE VALUE MATTERS AS MUCH AS THE NAME, AND THE FIRST EDITION CHECKED ONLY THE NAME. A second blind
 * review pointed out that the emitter writes `${name}:${value}`, so the separator can be made by the
 * join rather than by either half. Measured on 2026-09-03: a value of `=1` makes `X-V:=1`, which
 * HTTPie reads as its raw JSON separator and sends as the body `{"X-V": 1}` under a content type it
 * chose, with no such header on the request; `=true`, `="a"` and `=[1]` do the same silently. A
 * value of `@home` makes `X-At:@home`, which HTTPie reads as "take this header value from a file",
 * and with a file of that name present it sent the file's contents as the header value, exit 0.
 * That is the same correction SPEC 18 already made for `note=@home` in a form, carried to the header
 * path where it had been missed. A `@` later in the value is not a separator: `a@b.com` was measured
 * arriving intact, so only the first character is refused.
 */
export const HTTPIE_SEPARATOR_REFUSAL =
  'a header here carries "=" or "@" where HTTPie reads a separator rather than text, so the ' +
  'command would send a different request';

/**
 * Why HTTPie cannot frame the multipart body the runner frames.
 *
 * THE FIRST EDITION OF THIS REASON RESTED ON AN ARTIFACT AND IS CORRECTED HERE. It said HTTPie
 * "exits 1 and sends nothing" for a text value beginning with `@`; re-measured on 2026-09-03 with a
 * file actually named `home` in the working directory, `note=@home` exits 0 and sends
 * `note=from-a-file`, the file's contents, as the field value. The refusal is stronger than the
 * first reading, not weaker: instead of failing loudly, HTTPie silently sends a different value,
 * which is precisely the output SPEC 18 forbids. The same run showed a second divergence: a
 * `--form` request whose parts are all text is sent as `application/x-www-form-urlencoded`, not as
 * the multipart the runner framed.
 */
export const HTTPIE_MULTIPART_REFUSAL =
  'the request body is a multipart form; HTTPie has --form, but it reads a text value beginning ' +
  'with "@" as a file to load and sends that file\'s contents in its place, and it sends an ' +
  'all-text form as urlencoded rather than as multipart; the cURL, TypeScript and Python samples ' +
  'carry it';

/** Why wget cannot frame a multipart body: it has no form encoder at all. */
export const WGET_MULTIPART_REFUSAL =
  'the request body is a multipart form, and wget has no form encoder to frame one with; the ' +
  'cURL, TypeScript and Python samples carry it';

/**
 * Why PowerShell cannot frame the multipart body the runner frames.
 *
 * THE FIRST EDITION HAD THIS BACKWARDS AND IT IS CORRECTED HERE. It said `-Form` gives a text part
 * no content type; measured on 2026-09-03, `-Form @{ note = 'front' }` writes
 * `Content-Type: text/plain; charset=utf-8` into the part header, while this runner's own encoder
 * writes a plain text part with no content type at all, which the cURL suite already pins. So the
 * divergence is a header added rather than one missing, and the refusal stands on the corrected
 * fact.
 */
export const POWERSHELL_MULTIPART_REFUSAL =
  'the request body is a multipart form; Invoke-RestMethod has -Form, but it writes a ' +
  'Content-Type into every text part and this runner sends a plain text part with none, so the ' +
  'parts would differ; the cURL, TypeScript and Python samples carry it';

/**
 * Why `Invoke-RestMethod` cannot declare a content type on a bodyless `GET`.
 *
 * THE FIRST EDITION REFUSED EVERY METHOD AND WAS AN OVER-REFUSAL, WHICH THE METHOD MATRIX SETTLED.
 * Measured on 2026-09-03 with `-Headers @{ 'Content-Type' = 'application/json' }` and no `-Body`:
 * `GET` reached the server with no content type at all, while `HEAD`, `POST`, `PUT`, `DELETE` and
 * `OPTIONS` each carried it, as the runner does under every one of those methods. Refusing all six
 * dropped five tabs that would have sent exactly what the button sends, and an over-refusal costs a
 * reader a sample they could have used.
 *
 * WHAT IS STILL NOT COMPARED IS `Content-Length`, and that is stated rather than hidden. On the
 * bodyless methods where the runner sends none, PowerShell frames an empty body and sends
 * `Content-Length: 0`. It is not a header the plan states, both framings are legal for a request
 * with no content, and the suite compares the headers the plan states, as the cURL suite does.
 */
export const POWERSHELL_TYPED_EMPTY_REFUSAL =
  'this request is a GET that declares a content type and sends no body, and Invoke-RestMethod ' +
  'was measured to drop that header under GET alone, so the request would go without it';

/**
 * Why a body whose content type the plan does not carry cannot go to a command line tool.
 *
 * IT IS UNREACHABLE TODAY AND IS GUARDED ANYWAY, because "cannot arise now" and "cannot arise" are
 * different claims and `sample-request.ts` says as much where it reads the content type off the
 * plan. Measured on 2026-09-03: given a body and no content type, wget sends
 * `application/x-www-form-urlencoded` and HTTPie sends `application/json`, neither of which the
 * runner sent.
 */
export const UNTYPED_BODY_REFUSAL =
  'this request carries a body whose content type the plan does not state, and every command ' +
  'line tool here substitutes one of its own choosing, which would not be the request the runner ' +
  'sends';

/**
 * Why no language may write a sample for this request: the runner cannot send it either.
 *
 * MEASURED AT THE TRANSPORT AND NOT INFERRED FROM THE SPECIFICATION. `buildRequest` builds a `GET`
 * carrying a body, because OpenAPI lets a document declare one; `FetchHttpTransport` then throws
 * "Request with GET/HEAD method cannot have body" and no request leaves the process. Before this
 * was guarded, all fifteen emitters wrote a sample anyway and four of them, curl, wget, HTTPie and
 * PowerShell, were measured putting the body on the wire, so a page would have offered four working
 * commands beside a button that cannot run at all.
 *
 * THE SENTENCE THE TRANSPORT GAVE IS APPENDED TO THIS ONE, so the reason names the actual refusal
 * rather than the one shape this constant was first written for. `TRACE` reaches it too, and its
 * sentence is different.
 */
export const UNSENDABLE_PLAN_REFUSAL =
  'the runner refuses to send this request at all, so no sample can show it being sent.';

/**
 * Why no language may write a sample for this request: the runner will not build it either.
 *
 * THE SIBLING OF {@link UNSENDABLE_PLAN_REFUSAL} ONE STEP EARLIER IN THE SAME CHAIN, and it exists
 * because that step was silent. `buildRequest` refuses shapes an ordinary document may declare: a
 * cookie parameter, which `Cookie` being a forbidden header makes unsendable from a script, a
 * required parameter with nothing to seed it, a path template naming a parameter the operation does
 * not declare. Until 2026-09-03 the transform caught that refusal and returned nothing at all, so
 * the page drew no samples section, all fifteen languages vanished and no reason reached the
 * reader: exactly the silence SPEC 18's standing rule forbids, arrived at by a `catch`.
 *
 * THE SENTENCE THE RUNNER GAVE IS APPENDED TO THIS ONE, for the reason the constant above states.
 * The refusals differ per document and naming them here would be a second list of them, kept by
 * hand, beside the one `@openref/runner` already throws by name.
 */
export const UNBUILDABLE_REQUEST_REFUSAL =
  'the runner refuses to build this request at all, so no sample can show it being made.';

/**
 * Why no language may write a sample for an operation with nowhere to send.
 *
 * A REFUSAL RATHER THAN AN ABSENCE, SINCE 2026-09-03. A normalized OpenAPI document always carries
 * the specification's own default server, so this is the hand built document and the merged one
 * whose service declared none; writing a sample against an invented origin is the guess this
 * package exists not to make. What was wrong until that day was the other half: the operation was
 * handed back untouched, so the page said nothing, which is indistinguishable from a reference that
 * has no samples at all.
 */
export const NO_SERVER_REFUSAL =
  'this operation declares no server to send to, so there is no address a sample could be written ' +
  'against';

/**
 * Why a client that does not put the runner's octets on the wire may not write a non-ASCII header.
 *
 * THE HTTP SPECIFICATION PUTS THIS FORM OUTSIDE WHAT IS INTEROPERABLE, WHICH IS WHY NOBODY IS
 * "WRONG" AND THE FORM IS REFUSED INSTEAD. RFC 9110 section 5.5 says a field value is US-ASCII, that
 * the historical ISO-8859-1 allowance is obsolete, and that a recipient is to treat other octets as
 * opaque data. So there is no encoding a sample could be corrected into: the runner follows the
 * ByteString rule its own platform defines and emits one octet per code point, a sample is a UTF-8
 * source file and emits the UTF-8 encoding, and both are defensible readings of a form the
 * specification tells everyone not to use.
 *
 * MEASURED ON 2026-09-03 WITH THE VALUE `café`, ALL SEVEN CLIENTS THAT CAN BE RUN HERE. The runner
 * and Swift sent `63 61 66 E9`; curl, wget, HTTPie and Ruby sent `63 61 66 C3 A9`; PowerShell sent
 * nothing and failed with "Request headers must contain only ASCII characters". A language is
 * allowed to write this form only where it was measured to match, which is why the allowance is a
 * short list and not a judgement about the others.
 */
export const NON_ASCII_HEADER_REFUSAL =
  'a header value here carries a character outside US-ASCII, which RFC 9110 puts outside what an ' +
  'HTTP field value may carry, and this client was not measured putting the same octets on the ' +
  'wire as the runner; the TypeScript and Swift samples were';

/**
 * Why OkHttp cannot leave the body out on a method that requires one.
 *
 * THE MIRROR OF THE REFUSAL BELOW AND OFF THE SAME TWO FUNCTIONS. `Request.Builder.method` holds
 * two requirements: a body is rejected where `HttpMethod.permitsRequestBody` is false, which is
 * `GET` and `HEAD`, and a missing body is rejected where `HttpMethod.requiresRequestBody` is true,
 * which is `POST`, `PUT`, `PATCH`, `PROPPATCH` and `REPORT`. The first edition guarded one half and
 * not the other, and the half it missed is by far the commoner shape: a bodyless `POST` is an
 * everyday operation and the emitter wrote `.method("POST", null)` for it, which throws.
 *
 * BOTH HALVES ARE READ OFF THE LIBRARY AND NEITHER IS MEASURED HERE, and that is stated for the
 * same reason SPEC 18 names Kotlin as unproven at the wire: `kotlinc` and the OkHttp jar are not on
 * this machine and fetching them is a network dependency inside a test run.
 */
export const OKHTTP_MISSING_BODY_REFUSAL =
  'this request sends no body on a method OkHttp requires one for, and its request builder ' +
  'rejects that pair rather than sending it';

/**
 * What a client does with a redirect, where that is not what the runner does.
 *
 * A NOTE AND NOT A REFUSAL, AND THE MEASUREMENT IS WHY. The plan describes one request, and on a
 * 302 carrying `Authorization` all five clients that can be run here sent that first request byte
 * for byte identically on 2026-09-03. What differs is entirely what each does with the response:
 * the runner and wget followed and re-sent the credential, curl and HTTPie stopped at the first
 * response, and PowerShell and Swift followed and dropped the credential. Refusing a sample over
 * this would mean refusing every sample for every operation, since no document says whether a
 * response redirects; so it is returned as data a caller can print beside the tab.
 */
export const REDIRECT_NOT_FOLLOWED_NOTE =
  'this client stops at the first response, so a redirect is shown rather than followed; the ' +
  'console follows it and re-sends the credential';

/**
 * Why a client that invents a header the runner never sends may not write the sample.
 *
 * FOUND ONLY AFTER THE COMPARISON WAS WIDENED, WHICH IS THE POINT OF WIDENING IT. Until 2026-09-03
 * both wire suites compared the headers the plan named and nothing else, so a header a client added
 * of its own was outside what any case could see. That is SPEC 0's tenth class: a check whose method
 * excludes a class of defect, so its silence cannot be told from absence. Three clients were caught
 * by the widened comparison within one run, and all three turned out to be fixable in the emitter
 * rather than refusable, so this constant guards what a later one cannot fix.
 */
export const INVENTED_HEADER_REFUSAL =
  'this client adds a header of its own that the runner does not send, and there is no way to ' +
  'tell it not to, so the request would differ';

/** What a client that follows a redirect without the credential does, measured the same day. */
export const REDIRECT_CREDENTIAL_DROPPED_NOTE =
  'this client follows a redirect but does not re-send the Authorization header to the new ' +
  'address; the console re-sends it';

/**
 * What a tab strip keyed by `lang` costs a document that wrote two samples under one language.
 *
 * A NOTE RATHER THAN A SILENT DROP, AND THE ALTERNATIVE IS A MAJOR VERSION. `CodeSample` finds the
 * active sample by `lang` and keys the list by it, so a second entry under one id is a tab a reader
 * can click and never reach, and which of the two they see depends on list order. Making both
 * reachable needs a tab identity of its own on `IRCodeSample`, which is frozen public API and is
 * the same answer SPEC 18 already gives for the three shell aliases. So the second is left out of
 * the strip and the page says it was, because dropping it in silence is the one thing this whole
 * section exists to stop.
 */
export const UNREACHABLE_TAB_NOTE =
  'the document writes a second sample under a language it already used, and a tab strip keyed ' +
  'by language can show one of them, so the first is drawn and this one is not';

/** One sentence per cause, for a credential no request can carry at all. */
const UNSENDABLE_CREDENTIAL_CAUSES: Readonly<Record<UnsendableCause, string>> = {
  'mutual-tls': 'a client certificate chosen during the TLS handshake',
  'cookie-api-key': 'a key in a cookie, which is a header a browser will not let a script set',
  'http-challenge': 'a challenge and response the browser performs itself',
};

/**
 * Why every sample for this operation goes without the credential the operation requires.
 *
 * THE SAMPLES ARE CORRECT AND THEY WILL NOT AUTHENTICATE, WHICH IS WHY THIS IS A NOTE. Nothing is
 * wrong with what the emitters wrote: they put on the wire exactly what the console puts on the
 * wire, and the console cannot carry this credential either, per SPEC 19.7. Refusing the sample
 * would take away fifteen tabs that show the request faithfully; saying nothing leaves a reader
 * copying a command that returns 401 with the page having computed the reason and dropped it.
 * `placeholderCredentials` has returned `unsendable` since the generator was built and the
 * transform discarded it until 2026-09-04.
 *
 * THE CAUSE IS `core`'S AND THE WORDS ARE THIS PACKAGE'S, which is the division `credentials.ts`
 * in `@openref/runner` already states for the same union: the platform rule has one owner and each
 * interface says it to its own reader.
 *
 * @param schemeId - The scheme as the document names it, so a reader can find it
 * @param cause - Why a request cannot carry it, from `unsendableSchemeCause`
 * @returns The sentence the page prints under the tabs
 *
 * @example
 * unsendableCredentialNote('mtls', 'mutual-tls');
 */
export function unsendableCredentialNote(schemeId: string, cause: UnsendableCause): string {
  return (
    `no sample carries a credential for the security scheme "${schemeId}", because it is ` +
    `${UNSENDABLE_CREDENTIAL_CAUSES[cause]}; the console cannot send it either, so these samples ` +
    'show the request faithfully and will not authenticate'
  );
}

/**
 * Why the OkHttp half of `permitsRequestBody` needs no refusal of its own any more.
 *
 * IT WAS REMOVED RATHER THAN LEFT AS DEAD CODE. `Request.Builder.method` rejects a body on `GET`
 * and `HEAD`, and those are exactly the two methods the runner's own transport refuses to send a
 * body on, so {@link UNSENDABLE_PLAN_REFUSAL} now answers that request for every one of the
 * fifteen languages before any emitter is reached. Two reasons for one shape would have made which
 * one a reader sees depend on tab order, and the runner's is the better of the two: the request
 * cannot be sent at all, which is a stronger statement than one library declining to build it.
 */
