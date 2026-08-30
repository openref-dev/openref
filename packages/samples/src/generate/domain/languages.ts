/**
 * The nine languages of SPEC 18, and the two levels the specification splits them into.
 *
 * LEVEL 1 IS THIS PROJECT'S OWN GENERATOR AND LEVEL 2 IS A TEMPLATE, and the difference is not a
 * quality ranking, it is what each can express. The three level 1 emitters render every body shape
 * the runner can send, including the two that reach the plan as bytes: a multipart form and a
 * binary upload. The six level 2 templates render a text body and refuse a byte one by name, with
 * the reason attached, because the alternative is six hand written multipart encoders that no test
 * in this repository sends anywhere. A refusal a caller can read is the T050 rule about an
 * annotated payload applied to a language: a sample may show what the document declares and no
 * more.
 *
 * THE IDS ARE HIGHLIGHTER IDS AND NOT PRODUCT NAMES. `IRCodeSample.lang` reaches
 * `markdown.renderCode` on the server, which passes it to the highlighter, so `csharp` and not
 * `C#`; the product name is the label, which is what the tab says.
 */

/** Language ids, spelled as the highlighter spells them. */
export type SampleLanguageId =
  'shell' | 'typescript' | 'python' | 'go' | 'php' | 'java' | 'csharp' | 'ruby' | 'rust';

/** Which of the two generators of SPEC 18 produces a language. */
export type SampleLevel = 1 | 2;

/** One language a sample can be written in. */
export interface SampleLanguage {
  readonly id: SampleLanguageId;
  /** What the tab says. */
  readonly label: string;
  readonly level: SampleLevel;
}

/**
 * The nine, in the order SPEC 18 lists them.
 *
 * The order is the order the tabs appear in, so it is behaviour rather than presentation: level 1
 * first, cURL first inside it, because a reader who is checking what a request looks like reads
 * cURL and a reader who is copying code reads their own language.
 */
export const SAMPLE_LANGUAGES: readonly SampleLanguage[] = [
  { id: 'shell', label: 'cURL', level: 1 },
  { id: 'typescript', label: 'TypeScript', level: 1 },
  { id: 'python', label: 'Python', level: 1 },
  { id: 'go', label: 'Go', level: 2 },
  { id: 'php', label: 'PHP', level: 2 },
  { id: 'java', label: 'Java', level: 2 },
  { id: 'csharp', label: 'C#', level: 2 },
  { id: 'ruby', label: 'Ruby', level: 2 },
  { id: 'rust', label: 'Rust', level: 2 },
];

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
