/**
 * Reads the committed artefact back and refuses anything in it that its position does not admit.
 *
 * THE GENERATOR IS THE GUARANTEE. THIS SCAN IS A BACKSTOP. Say it in that order, because the
 * previous version of this file said the opposite and the opposite is not true. `lib/projection.ts`
 * reads named fields out of the documents, a line count, a box, a range, a digest of a title, and
 * writes those and nothing else. Content can travel only if somebody CHANGES THE GENERATOR to carry
 * it. That is the whole of the privacy guarantee and it lives there, not here.
 *
 * WHAT THIS FILE IS FOR, then, is two jobs and no third:
 *
 * - CATCH A GENERATOR MISTAKE. A field added to the projection has to be given a grammar here
 *   before the artefact may carry it, so a new kind of value is justified rather than admitted in
 *   silence. Every JSON shape is judged by that lookup, booleans, nulls, empty arrays and empty
 *   objects included, because a key whose value is any of those is still a key.
 * - BOUND THE VOLUME OF WHATEVER DOES TRAVEL, AND BOUND IT ON THE ARTEFACT AS A WHOLE. The second
 *   half of that sentence is what this round adds, and the file was wrong without it. An unbounded
 *   repetition is the difference between a slip and a channel: a thousand lines of CSS custom
 *   properties, or two thousand digests of eight arbitrary bytes each, are not a leak the shape of
 *   one value and no per value rule can see them. So every position limits how many leaves may
 *   stand there and every document position its lines, and each of those numbers is defensible on
 *   its own. PER POSITION BOUNDS STILL CANNOT BOUND VOLUME, BECAUSE THEY MULTIPLY: measured on
 *   2026-09-03 by filling every position to exactly its own limit, 4,725,296 bytes over 6,840
 *   leaves went through this scan with ZERO findings, 37 times the committed artefact. What bounds
 *   the volume is {@link PROJECTION_ARTEFACT_BUDGET}, one byte figure and one leaf figure over the
 *   whole file, in the same file every other threshold in this project lives in. The per position
 *   counts are kept and are not that: they are anomaly detection on one position, and this comment
 *   is careful not to describe them as the thing that bounds the file, because the previous version
 *   did and it was not true.
 *
 * WHAT IT IS NOT, and this is the sentence the earlier version of this file owed its reader. IT IS
 * NOT A DEFENCE AGAINST SOMEBODY DELIBERATELY CRAFTING A LEAK TO LOOK LIKE AN IDENTIFIER. A
 * whitelist of SHAPES cannot separate prose from data at the boundary, because a four word
 * hyphenated leak and a four word hyphenated identifier ARE THE SAME SHAPE. `--the-runner-ships-now`
 * and `--oref-motion-duration-fast` are the same grammar, the same length and the same segment
 * count, and no bound tells them apart. An author who wants to write a sentence into a position and
 * is willing to spell it like an identifier can do so within every bound below. What stops that
 * author is code review of the generator, which is a person, and nothing in this file pretends
 * otherwise. {@link ACKNOWLEDGED_RESIDUE} names what fits under the bounds as they stand.
 *
 * WHERE THE BOUNDS COME FROM, WHICH IS THE OTHER THING THIS FILE GOT WRONG. They used to be the
 * largest value the artefact happened to hold plus ten percent, borrowed from `SIZE_BUDGETS`, whose
 * subject is BYTES OF A BUILT ARTEFACT. A byte budget's margin says nothing about how many segments
 * an identifier may legitimately have, and sized that way the bounds reddened ordinary future work:
 * a required document named `ai-docs/00-overview/PROJECT-STANDARDS.md`, a fourth stylesheet, a
 * seven part token name, a SPEC 21 row called `Observability`, the milestone `RELEASE`. A privacy
 * check that reddens on honest work gets edited away, and then it protects nothing. Every bound
 * below is instead sized to WHAT ITS KIND CAN LEGITIMATELY BE, with real headroom above the reading
 * the artefact gives today, and each one names the value that sets its floor.
 *
 * A REMAINING KNOWN GAP, named rather than assumed away. `data.claimMap[].proofs[]` holds
 * repository paths and a real one reaches 68 characters over ten segments. WHAT CLOSES THAT IS
 * ANOTHER GATE AND NOT THIS FILE: `claims` refuses a proof path that names no file in the
 * repository, so a sentence there is red for a different reason. {@link NULLABLE_PATHS} is written
 * from the interface in `lib/projection.ts` by hand; a position that becomes nullable and is not
 * added there goes red rather than quiet, which is the direction that is safe.
 */

import { PROJECTION_ARTEFACT_BUDGET, PROJECTION_LEAF_FLOOR } from '../config.js';

/** What a legitimate leaf turned out to be, in the vocabulary `tools/gates/README.md` publishes. */
export type ValueKind = 'number' | 'box' | 'identifier' | 'digest' | 'motion-value';

/** What JSON said a leaf was, so a position can refuse a shape and not only a spelling. */
export type LeafShape = 'string' | 'number' | 'boolean' | 'null' | 'empty array' | 'empty object';

/** One leaf as the walk found it. */
export interface Leaf {
  readonly shape: LeafShape;
  /** How the value reads, empty for the three shapes that hold nothing. */
  readonly text: string;
}

/** One leaf the scan refuses, with where it sits and why it is not one of the kinds above. */
export interface ProseFinding {
  /**
   * Which of the two jobs found it: the grammar and reach of one value, or the volume of many.
   *
   * They are reported apart because they are answered apart. A refused leaf is a value nobody
   * should have written; an exceeded volume is a repetition of values that are each in order.
   */
  readonly rule: 'leaf-refused' | 'volume-exceeded';
  /** Path into the artefact, array indices collapsed, so two leaves of a kind read alike. */
  readonly path: string;
  readonly value: string;
  readonly reason: string;
}

/**
 * How far one value reaches, in the four ways a sentence has to reach in order to be one.
 *
 * A grammar of `[a-z0-9-]+` and a grammar of `[A-Za-z]+` both admit a sentence, one written with
 * hyphens and one with camel humps, and neither says so. The first three measures say it.
 *
 * THE FOURTH IS THERE BECAUSE THE SEGMENTER CANNOT DIVIDE A RUN OF CAPITALS. `segmentsOfToken`
 * breaks a camel hump by finding a capital with a lowercase after it, so `DROPTELLTALEBEFOREM8` is
 * ONE segment at any word count and used to walk past every segment bound in the file. Nothing can
 * tell where the words end in a run of capitals without a dictionary, so the run is not segmented,
 * it is MEASURED: {@link Extent.capitals} is the longest unbroken run of capital letters, and each
 * position bounds it at what its own vocabulary needs.
 */
export interface Extent {
  /** Characters, after every digest and the space before it are removed. */
  readonly chars: number;
  /** Separator delimited segments over the whole value. */
  readonly segments: number;
  /** The most of those segments packed into one token, a token being a run with no separator. */
  readonly perToken: number;
  /** The longest unbroken run of capital letters, which is the one thing segmentation cannot cut. */
  readonly capitals: number;
}

/** How many leaves, lines and digests one position held. */
export interface Volume {
  /** Leaves seen at the position over the whole artefact. */
  readonly leaves: number;
  /** Lines in the largest single leaf, one for a position that holds a token rather than a text. */
  readonly mostLines: number;
  /** Lines over every leaf at the position together. */
  readonly lines: number;
}

/** The result of reading the whole artefact. */
export interface ProseScan {
  readonly findings: readonly ProseFinding[];
  /** How many leaves were examined, so a scan over nothing cannot read as a clean scan. */
  readonly leaves: number;
  /** Which kinds of value the artefact actually carries, sorted, one entry per kind. */
  readonly kinds: readonly ValueKind[];
  /** The positions the walk reached, sorted, so a rule with nothing to check can be found. */
  readonly paths: readonly string[];
  /** Where the walk found null or an empty collection, sorted, so an absence is reported. */
  readonly absences: readonly string[];
  /** The largest extent found at each position, so a reading can be published beside its bound. */
  readonly reach: Readonly<Record<string, Extent>>;
  /** How much stood at each position, so the volume bounds can be published beside their reading. */
  readonly volume: Readonly<Record<string, Volume>>;
  /** Digests over the whole artefact, which is the one count no single position can bound. */
  readonly digests: number;
  /**
   * What the whole file weighs, which is the quantity the per position bounds multiply into.
   *
   * It is the caller's reading where the caller has the file, and the writer's own serialization
   * otherwise. The two differ by 560 bytes on the committed artefact, measured, because
   * `gates:projection` runs prettier over what `writeProjection` produces; that difference is far
   * under the granularity of the budget it is compared against.
   */
  readonly bytes: number;
}

/** The word a deferral marker opens with, fixed by `MARKER_PATTERN` in `deferrals.ts`. */
const DEFERRAL_WORD = 'DEFER';

/** The two words a provenance marker opens with, fixed by the same pattern. */
const PROVENANCE_WORDS = ['с', 'from'] as const;

/** The only classifications `findMarkers` gives a marker. */
const MARKER_KINDS = ['deferral', 'provenance', 'ambiguous', 'quotation'] as const;

/** The only status a claim map row carries that is not a task id, from `PROVED` in `claims.ts`. */
const CLAIM_STATUSES = ['proved'] as const;

/** The units SPEC 20 and the claim map write a quantity in. */
const UNITS = ['КБ', 'МБ', 'байт', 'bytes', 'KB', 'MB', 'с', 's'] as const;

/** The words SPEC 20 writes for a row that is recorded and gated by nothing. */
const REPORT_MARKER = 'порога нет';

/** The comparison operators `boundDirectionOfCell` reads a bound direction out of. */
const BOUND_OPERATORS = ['≤', '≥', '<=', '>=', '<', '>'] as const;

/** A number as a projected declaration writes one. */
const CSS_NUMBER = String.raw`-?\d+(?:\.\d+)?`;

/** The only functions a projected declaration value calls, with what each one is allowed to take. */
const CSS_FUNCTIONS: readonly { readonly name: string; readonly takes: string }[] = [
  { name: 'var', takes: String.raw`--[a-z0-9-]+` },
  { name: 'cubic-bezier', takes: `${CSS_NUMBER}(?:, ${CSS_NUMBER}){3}` },
];

/** The selector parts the theme stylesheets under `ai-docs/` are written with. */
const CSS_SELECTORS = [
  ':root',
  "[data-oref-color-scheme='light']",
  "[data-oref-color-scheme='dark']",
] as const;

/** The at-rule preludes those stylesheets open a block with. */
const CSS_AT_RULES = ['@media (prefers-reduced-motion: reduce)'] as const;

const alternation = (words: readonly string[]): string =>
  words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`)).join('|');

const DIGEST = String.raw`#[0-9a-f]{16}`;
const TASK_ID = String.raw`T\d{3}`;

/**
 * A numbered milestone, and the first of the three places a run of digits used to be unbounded.
 *
 * THE DIGIT CHANNEL, WHICH IS WHAT THIS AND THE TWO BELOW CLOSE. A reviewer put 4.72 MB through
 * this scan and two thirds of it was digits, at positions no character bound could reach because
 * digits are the one thing a character bound counts one for one. `M\d+` in an amendment milestone
 * line took EIGHTY of them, since that line's bound is 96 characters and `**Milestone:** M` is 16;
 * in a plan milestone line it took 43, and in a marker 61. Milestones are an enumerated kind: this
 * project has run M0 to M7, and two digits is every one it can have plus ninety more. It is a
 * bound rather than a list only because a plan may legitimately reach M10.
 */
const NUMBERED_MILESTONE = String.raw`M\d{1,2}`;

/**
 * A milestone id wherever the whole vocabulary is allowed, which is what a deferral marker takes.
 *
 * IT IS THE LIST `deferrals.ts` AND `static-suites.ts` ALREADY READ MILESTONES OUT OF. A provenance
 * marker and a bare marker take {@link NUMBERED_MILESTONE} alone, because `MARKER_PATTERN` in
 * `deferrals.ts` writes them that way and a grammar looser than the generator it reads is room
 * nobody asked for.
 */
const MILESTONE_ID = String.raw`${NUMBERED_MILESTONE}|RELEASE|POST-1\.0`;

/**
 * An amendment entry id: a retrofit of a numbered task, or a `TX-` name.
 *
 * BOTH HALVES ADMITTED ARBITRARY DIGITS AND BOTH ARE CLOSED HERE. `R\d*` took eighty of them
 * inside a 96 character amendment line; the revisions this repository has written are `R`, `R1`,
 * `R2`, `R3` and `R4`, so two digits is ninety nine of them. The `TX-` half took digits as well,
 * and it is now exactly what `OWNED_ENTRY_LINE` in `lib/projection.ts` can emit, `TX-[A-Z-]+`,
 * for the same reason the milestone vocabulary follows `deferrals.ts`.
 */
const OWNED_ID = String.raw`T\d{3}-R\d{0,2}|TX-[A-Z-]+`;

const CUSTOM_PROPERTY = String.raw`--[a-z0-9-]+`;

/**
 * One figure a claim map row states, in the spellings `projectFigures` can produce.
 *
 * `\d[\d,]*` TOOK 800 DIGITS IN ONE RUN, which is the character bound of that position and is not
 * a figure at all. Measured over the 259 figures the committed artefact carries: at most six
 * digits, at most one thousands separator, one or two decimal places, and sometimes a trailing
 * comma, because the cell wrote one after the number and the projection keeps the spelling. The
 * grammar takes two separators rather than the one the reading gives, so a figure in the millions
 * is not a false positive waiting to happen. Nine integer digits and four decimal places is a byte
 * count of a gigabyte with room to spare.
 */
const FIGURE = String.raw`(?:\d{1,3}(?:,\d{3}){0,2}|\d{1,9})(?:\.\d{1,4})?,?(?: ?(?:${alternation(UNITS)}))?`;

/**
 * Most figures one claim map row may state.
 *
 * The fullest row today states 68, which is a table of measurements rather than a number, and this
 * is twice that. Before it the count was unbounded and only the character bound stood against a
 * row of nothing but digits.
 */
const FIGURES_IN_A_ROW = 136;

/**
 * A number as a SPEC 20 threshold cell writes one, thousands separated with a space.
 *
 * BOUNDED FOR THE REASON THE FIGURE ABOVE IS. `\d[\d ]*` admitted twenty four digits under this
 * position's character bound; the table's own widest cell is `≤ 24 900 байт`, which is five.
 */
const THRESHOLD_NUMBER = String.raw`(?:\d{1,3}(?: \d{3}){0,2}|\d{1,9})(?:\.\d{1,4})?`;

const IS_DIGEST = new RegExp(`^${DIGEST}$`, 'u');

/**
 * The file names this repository writes with no extension at all, which is a closed vocabulary.
 *
 * WHY AN ENUMERATION AND NOT A RULE. A final segment with no dot in it, admitted as a shape, makes
 * every bare word a path: `the-runner-ships-without-the-proxy` and `DROPTELLTALEBEFOREM8` are both
 * one segment ending in no extension, and that is the hole the dot rule in {@link IS_REPO_PATH} was
 * defending. An enumeration closes it the way `MILESTONE_ID` and `MARKER_KINDS` close theirs: what
 * may stand here is two fixed words and nothing else, so no author chooses the content.
 *
 * WHY IT IS NOT PADDED WITH THE WORDS A REPOSITORY MIGHT HAVE. `CODEOWNERS`, `AUTHORS`, `COPYING`
 * and `Dockerfile` are all plausible and none of them is a file here, and every speculative word
 * added is one more bare word admitted for nothing. `projection.spec.ts` holds this list to
 * `git ls-files` in BOTH directions: a tracked file with no extension that is not named here is
 * red, and a name here that no tracked file carries is red as well. So the list cannot go stale
 * without saying so, and cannot grow without a file arriving first.
 */
export const EXTENSIONLESS_FILES = ['LICENSE', 'NOTICE'] as const;

/**
 * A repository relative path, as this repository actually names files.
 *
 * MEASURED AGAINST THE TRACKED FILES RATHER THAN IMAGINED, on 2026-09-03 over 1,410 of them, and
 * the reading is now zero refused. The shape it had refused 53, and two of those classes are files
 * a claim map proof can legitimately cite: a name whose dotted parts carry hyphens, which is every
 * corpus snapshot, including
 * `packages/core/test/corpus/snapshots/oai-3.2-query-example.yaml.ir.json`, the very file the
 * review measured at exactly its per token bound and which this grammar was refusing outright; and
 * a dotfile, such as `.dependency-cruiser.cjs`, which is where the dependency rules live.
 *
 * THE THIRD CLASS WAS 23 EXTENSIONLESS FILES AND REFUSING IT WAS A REAL FALSE NEGATIVE. They are
 * the `LICENSE` at the repository root and in every published package, and the `NOTICE` beside each
 * vendored corpus. This project found that no published package shipped a LICENSE and fixed it, so
 * a claim whose proof IS a licence file is exactly the claim that gets written next, and until this
 * round the grammar could not express it. What admits them is {@link EXTENSIONLESS_FILES}, an
 * enumeration rather than a loosened shape, so a bare word that is not one of those two names is
 * still not a path.
 */
const IS_REPO_PATH = new RegExp(
  String.raw`^(?:[A-Za-z0-9._-]+/)*(?:\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*|[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+|${alternation(EXTENSIONLESS_FILES)})$`,
  'u',
);
const IS_PACKAGE = /^(?:openref|@openref\/[a-z0-9-]+)$/u;
const IS_SPEC_CLAUSE = /^\d+\.\d+$/u;
const IS_CLAIM_ID = /^(?:\d+\.\d+[a-z]?|[a-z][a-z0-9]*(?:-[a-z0-9]+)*)$/u;
const IS_CLAIM_STATUS = new RegExp(`^(?:${alternation(CLAIM_STATUSES)}|${TASK_ID})$`, 'u');
const IS_MARKER_KIND = new RegExp(`^(?:${alternation(MARKER_KINDS)})$`, 'u');
const IS_MARKER_TEXT = new RegExp(
  `^\\((?:${DEFERRAL_WORD} (?:${MILESTONE_ID})(?:, \`(?:${OWNED_ID})\`)?|(?:${alternation(PROVENANCE_WORDS)}) ${NUMBERED_MILESTONE}|${NUMBERED_MILESTONE})\\)$`,
  'u',
);
const IS_MILESTONE = new RegExp(`^(?:${MILESTONE_ID})$`, 'u');
const IS_SUITE_ROW = /^[A-Z][A-Za-z]*$/u;
const IS_ROUTE = /^<route>(?:\/(?:\{[A-Za-z][A-Za-z0-9]*\}|[a-z][a-z0-9-]*))*$/u;
const IS_THRESHOLD = new RegExp(
  `^(?:(?:${alternation(BOUND_OPERATORS)}) )?(?:${REPORT_MARKER}|${THRESHOLD_NUMBER}(?: (?:${alternation(UNITS)}))?)$`,
  'u',
);
const IS_FIGURE = new RegExp(`^${FIGURE}$`, 'u');

/**
 * The lines a surrogate `BUILD.md` may hold.
 *
 * THE MILESTONE LINE TOOK THE ENUMERATED VOCABULARY, having been `[A-Z][A-Z0-9]*`. That admitted
 * `**DROPTELLTALEBEFOREM8**`, which is a sentence in capitals and matched as one token of one
 * segment. `MILESTONE_ID` is the list `deferrals.ts` and `static-suites.ts` already read milestones
 * out of, so nothing legitimate loses a line, and the capitals bound below catches the same class
 * wherever a position cannot enumerate its vocabulary.
 */
const BUILD_LINES: readonly RegExp[] = [
  /^$/u,
  new RegExp(`^- \\[[ x]\\] \`${TASK_ID}\` L\\d{4}-L\\d{4} ${DIGEST}$`, 'u'),
  new RegExp(`^### ${TASK_ID} \\[[ x]\\] ${DIGEST}$`, 'u'),
  new RegExp(`^\\*\\*(?:${MILESTONE_ID})(?: - ${DIGEST})?\\*\\*$`, 'u'),
];

const AMENDMENT_LINES: readonly RegExp[] = [
  /^$/u,
  new RegExp(`^### \\[[ x]\\] \`${TASK_ID}\`(?: ${DIGEST})+$`, 'u'),
  new RegExp(`^### \\[[ x]\\] \`(?:${OWNED_ID})\` ${DIGEST}$`, 'u'),
  new RegExp(`^\\*\\*Milestone:\\*\\* (?:${MILESTONE_ID})$`, 'u'),
  new RegExp(`^#{2,3} ${DIGEST}$`, 'u'),
];

const CSS_CALL = CSS_FUNCTIONS.map((fn) => `${fn.name}\\(${fn.takes}\\)`).join('|');
const CSS_SELECTOR_LIST = `(?:${alternation(CSS_SELECTORS)})(?:, (?:${alternation(CSS_SELECTORS)}))*`;
const IS_CSS_BLOCK_OPEN = new RegExp(
  `^(?:${CSS_SELECTOR_LIST}|${alternation(CSS_AT_RULES)}) \\{$`,
  'u',
);
const IS_CSS_INERT = new RegExp(`^${CUSTOM_PROPERTY}: 0;$`, 'u');
const IS_CSS_MOTION = new RegExp(
  `^${CUSTOM_PROPERTY}: (?:${CSS_NUMBER}(?:ms|s)|${CSS_CALL});$`,
  'u',
);

/**
 * One selector of a list, as a source stylesheet writes it before the next one.
 *
 * A PROJECTED BLOCK JOINS ITS SELECTORS ONTO ONE LINE and the source writes one per line, ending
 * each but the last with a comma. So `:root,` is a line of a private document that occurs inside a
 * line of the artefact, and it is not itself a line of the artefact. It is enumerated here so that
 * the sweep in `projection.spec.ts` can account for it by name rather than by a length filter that
 * happened to exclude it.
 */
const IS_CSS_SELECTOR_PART = new RegExp(`^(?:${alternation(CSS_SELECTORS)}),$`, 'u');

/**
 * A run with no separator in it, which is where a camel humped or hyphenated sentence hides.
 *
 * `<` and `>` are outside it, so `<route>` is one token rather than three, and so are the quotes
 * and brackets of a selector.
 */
const TOKEN = /[\p{L}\p{N}._-]+/gu;

/** What breaks one token into segments, beside the camel humps handled with it. */
const TOKEN_BREAK = /[._-]+/u;

/** A run of capital letters, in any alphabet, which is what the segmenter cannot divide. */
const CAPITALS = /\p{Lu}+/gu;

/**
 * Every digest and the separator in front of it, removed before a value is measured.
 *
 * THE SPACE GOES WITH IT, WHICH IT DID NOT USED TO. A surrogate amendment heading carries the
 * digest of every prefix of its title, fifty of them on the longest heading today, and stripping
 * only the digests left fifty spaces behind, so the character bound of that position had to be
 * loose enough to hold them and then held nothing. The count of digests is bounded on its own, by
 * {@link Position.digestsPerLine} and {@link DIGESTS_IN_THE_ARTEFACT}, which is where a repetition
 * belongs. See {@link extentOf}.
 */
const EVERY_DIGEST = new RegExp(` ?${DIGEST}`, 'gu');

/**
 * Anything shaped like a digest, so one that is not exactly a digest cannot hide inside a strip.
 *
 * A DIGEST IS SIXTEEN LOWERCASE HEX AND ANYTHING ELSE IS A FINDING. `#` followed by thirty two hex
 * characters used to lose its first sixteen to {@link EVERY_DIGEST} and pass as a sixteen character
 * token; `#DEADBEEFDEADBEEF` in capitals is not a digest at all. Both are refused by name.
 */
const DIGEST_LIKE = /#[0-9a-fA-F]{8,}/gu;

const segmentsOfToken = (token: string): string[] =>
  token
    .split(TOKEN_BREAK)
    .flatMap((part) =>
      part
        .replace(/(\p{Ll}|\p{N})(\p{Lu})/gu, '$1 $2')
        .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2')
        .split(' '),
    )
    .filter((segment) => segment.length > 0);

/**
 * How far one value reaches.
 *
 * DIGESTS ARE REMOVED FIRST, AND THAT IS AN EXEMPTION RATHER THAN A CONVENIENCE. A digest is
 * sixteen hex characters of a fixed shape that no reader can read and that carries no word. What is
 * left after they go is what a sentence would have to be written in. What they carry as BITS is not
 * measured here and cannot be: it is bounded by counting them instead.
 *
 * @param value - The value, or one line of it
 * @returns Its reach, in characters, segments, segments packed into one token, and capitals
 */
export function extentOf(value: string): Extent {
  const measured = value.replace(EVERY_DIGEST, '');
  const counts = (measured.match(TOKEN) ?? []).map((token) => segmentsOfToken(token).length);
  const runs = (measured.match(CAPITALS) ?? []).map((run) => run.length);

  return {
    chars: measured.length,
    segments: counts.reduce((total, count) => total + count, 0),
    perToken: counts.reduce((most, count) => Math.max(most, count), 0),
    capitals: runs.reduce((most, run) => Math.max(most, run), 0),
  };
}

/**
 * How many digests a value carries, and whether anything in it only looks like one.
 *
 * @param value - The value, or one line of it
 * @returns The count, and the near misses, which are always findings
 */
export function digestsIn(value: string): { readonly count: number; readonly wrong: string[] } {
  const like = value.match(DIGEST_LIKE) ?? [];
  const wrong = like.filter((match) => !IS_DIGEST.test(match));

  return { count: like.length - wrong.length, wrong };
}

/**
 * A repository relative path, at any position that holds one.
 *
 * WHAT SETS THE FLOOR: `ai-docs/00-overview/PROJECT-STANDARDS.md` is a required document waiting to
 * be added and is 40 characters over 7 segments; `ai-docs/design/telltale/tokens-dark.css` is a
 * fourth stylesheet and is 39. The longest proof path the claim map holds today is 68 characters
 * over 10 segments. Capitals are bounded at 16 because the longest run a real path holds is the 10
 * of `BUILD-AMENDMENTS`, and a screaming directory name is not a thing this repository writes.
 *
 * THE PER TOKEN BOUND IS 12 AND WAS 8, WHICH IS A READING THAT HAD NO ROOM AT ALL ABOVE IT.
 * `packages/core/test/corpus/snapshots/oai-3.2-query-example.yaml.ir.json` is a file in this
 * repository today, and `/` is not a token break, so its last token divides into exactly 8:
 * `oai`, `3`, `2`, `query`, `example`, `yaml`, `ir`, `json`. One more dot part in a corpus snapshot
 * name reddened this position, and adding a corpus document is a normal week here. A snapshot name
 * is a document name, a version, a kind and an extension, so 12 is four more parts than the
 * fullest one anybody has written.
 */
const PATH_BOUND: Extent = { chars: 120, segments: 16, perToken: 12, capitals: 16 };

/**
 * A package name, published, internal or ecosystem, all three being the same kind.
 *
 * WHAT SETS THE FLOOR: `@openref/collector-throttler` is 28 characters and was over the bound the
 * published list carried; `@openref/collector-access-control` is 33 over 4 segments and is the
 * longest name SPEC 4 states. The grammar admits no capital at all, so the capitals bound is zero
 * and costs nothing.
 */
const PACKAGE_BOUND: Extent = { chars: 48, segments: 8, perToken: 6, capitals: 0 };

/**
 * A SPEC 13.3 reader page route.
 *
 * WHAT SETS THE FLOOR: `<route>/operations/{operationId}` is 32 characters and was over the bound;
 * the longest route the specification states today is 27. A parameter is camel cased, so one
 * capital per hump and two is room for a name like `{nodeIRef}`. Eight segments is twice the four
 * the longest route divides into, because a reader page route is two or three path segments and a
 * parameter, and never a paragraph.
 *
 * 64 CHARACTERS AND NOT 48, BECAUSE 48 HAD NOTHING ABOVE IT EITHER.
 * `<route>/runtime-facts/collectors/{collectorName}` is 48 exactly, and a runtime facts route with
 * a named collector is the next reader page this project has any reason to add. A route is a
 * couple of hyphenated path segments and a camel cased parameter; 64 holds the longest one anybody
 * has proposed with sixteen characters over it, which is one more segment.
 */
const ROUTE_BOUND: Extent = { chars: 64, segments: 8, perToken: 4, capitals: 2 };

/**
 * A milestone id, wherever one stands on its own.
 *
 * WHAT SETS THE FLOOR: `RELEASE` is 7 characters of capitals and `POST-1.0` is 8 over 3 segments,
 * and both were over a bound of 3 taken from `M3`. Capitals at 8 admit both and refuse a word.
 */
const MILESTONE_BOUND: Extent = { chars: 12, segments: 3, perToken: 3, capitals: 8 };

/**
 * The longest unbroken run of capitals a `TX-` id may write, wherever one of them stands.
 *
 * THE BOUND FOLLOWS THE KIND AND NOT THE POSITION, WHICH IS THE DEFECT THIS CONSTANT FIXES. One id
 * sits at three positions: `data.markers[].entry` on its own, `data.markers[].text` inside a
 * deferral marker, and `data.amendments` inside the entry's heading. Those carried 12, 12 and 16,
 * so `TX-REDUCEDMOTION-CONTRACT`, which writes 13, was ADMITTED as a line of the surrogate document
 * and REFUSED as the id inside it. The same id at two positions cannot have two answers; the kind
 * decides, so all three take this.
 *
 * WHAT SETS IT: `TX-GLOBALGUARD` writes 11 today, because a compound `TX-` name is written without
 * a hyphen, and `TX-REDUCEDMOTION-CONTRACT` writes 13. 16 holds a compound of two ordinary words
 * with room. WHAT IT COSTS IS STATED RATHER THAN SMOOTHED OVER: at 12 this position refused
 * `NOPROXYUNTILM8`, a sentence of four words in capitals, and at 16 it admits it. That is the trade
 * this file's own ruling demands, since a 13 capital id and a 14 capital sentence are the same
 * shape, and it is why the volume of this position is now bounded by
 * {@link PROJECTION_ARTEFACT_BUDGET} rather than by hoping a run of capitals stays short.
 * {@link ACKNOWLEDGED_RESIDUE} names it.
 */
const TX_CAPITALS = 16;

/**
 * An amendment entry id, being a retrofit id or a `TX-` id.
 *
 * WHAT SETS THE FLOOR: `TX-SURFACE-REGISTER` is 19 characters over 3 segments with a run of 8
 * capitals. The capitals bound is {@link TX_CAPITALS}, which is the kind's and not this position's.
 */
const ENTRY_BOUND: Extent = { chars: 32, segments: 6, perToken: 6, capitals: TX_CAPITALS };

/**
 * A parenthesised deferral or provenance marker, whose grammar already encloses an entry id.
 *
 * WHAT SETS THE FLOOR: `(DEFER POST-1.0, \`TX-SURFACE-REGISTER\`)` is 41 characters over 8
 * segments, which is the marker vocabulary at full length. The capitals bound is the entry id's,
 * because the value encloses one.
 */
const MARKER_BOUND: Extent = { chars: 64, segments: 12, perToken: 6, capitals: TX_CAPITALS };

/**
 * A claim map or budget id.
 *
 * WHAT SETS THE FLOOR: the reviewer's 32 character id, against a bound of 31 taken from the 28 of
 * the longest one today. The grammar admits no capital.
 */
const CLAIM_ID_BOUND: Extent = { chars: 48, segments: 8, perToken: 8, capitals: 0 };

/**
 * A SPEC 21 row label.
 *
 * WHAT SETS THE FLOOR: a row called `Observability` is 13 characters against a bound of 11 taken
 * from `Federation`. Two segments is a camel cased pair like `RuntimeFacts`, and three is room.
 */
const SUITE_ROW_BOUND: Extent = { chars: 24, segments: 3, perToken: 3, capitals: 2 };

/** A SPEC 22 clause id, being a decimal clause number. */
const CLAUSE_BOUND: Extent = { chars: 12, segments: 3, perToken: 3, capitals: 0 };

/** A claim map status, being the word `proved` or a task id. */
const STATUS_BOUND: Extent = { chars: 12, segments: 2, perToken: 2, capitals: 2 };

/** One of the four marker kinds, which are enumerated words. */
const KIND_BOUND: Extent = { chars: 16, segments: 2, perToken: 2, capitals: 0 };

/** A SPEC 20 threshold cell, being an operator, a figure and a unit, or the recorded-only marker. */
const THRESHOLD_BOUND: Extent = { chars: 24, segments: 5, perToken: 2, capitals: 3 };

/**
 * The figures one claim map row states, separated by `" ; "`.
 *
 * The fullest row today reads 574 characters over 115 segments, and the bound is a table about two
 * fifths longer again, 800 over 160. THE SEGMENT COUNT IS NOT THE FIGURE COUNT and this comment
 * used to say it was:
 * `156,672 bytes` is one figure of three segments, so the 115 is 68 figures. What bounds the
 * figures is {@link FIGURES_IN_A_ROW} and what bounds the digits inside one is {@link FIGURE},
 * because a character bound of 800 over a run of digits is not a bound on a figure at all.
 */
const FIGURES_BOUND: Extent = { chars: 800, segments: 160, perToken: 3, capitals: 3 };

/** A number written as one: a version, a byte count, a line position. */
const NUMBER_BOUND: Extent = { chars: 12, segments: 1, perToken: 1, capitals: 0 };

/** A digest, which measures nothing at all once it is removed. Its count is bounded elsewhere. */
const DIGEST_BOUND: Extent = { chars: 0, segments: 0, perToken: 0, capitals: 0 };

/**
 * One line of a projected stylesheet.
 *
 * WHAT SETS THE FLOOR: `--oref-color-scheme-dark-surface-raised-hover: 0;` is a seven part token in
 * a naming scheme this repository already writes five part names in, and it was over a bound of 6
 * taken from the longest name today. The longest line today is the 74 characters of the easing
 * curve. Capitals are zero because a custom property, a selector and an at-rule prelude are all
 * lowercase in the enumerated grammar above.
 *
 * EIGHT PARTS AND NOT MORE, which is one above the longest name anybody has proposed. A design
 * token is a prefix, a group, a name, a variant and a state, and the two beyond that are the
 * headroom. Nine is where a property name stops being a name.
 */
const CSS_LINE_BOUND: Extent = { chars: 96, segments: 16, perToken: 8, capitals: 0 };

/**
 * One line of a surrogate `BUILD.md`.
 *
 * THE READING IS 24 CHARACTERS AND THIS COMMENT SAID 26, which is the third hand written figure in
 * this file that did not reproduce. The fullest line, with its digest and the space before it
 * removed, is a CONTENTS line: `- [x] \`T001\` L0171-L0196`, 24 characters. It is not retyped here
 * from a reading anybody took: {@link CITED_READINGS} carries it and a case derives it from the
 * committed artefact. Capitals at 12 hold `RELEASE` with room and refuse the nineteen of
 * `DROPTELLTALEBEFOREM8`, which is the plant that walked past this position when a run of capitals
 * was one segment.
 */
const BUILD_LINE_BOUND: Extent = { chars: 48, segments: 8, perToken: 4, capitals: 12 };

/**
 * One line of a surrogate `BUILD-AMENDMENTS.md`.
 *
 * THE LONGEST LINE IS 31 CHARACTERS AND IT IS NOT THE ONE THIS COMMENT USED TO NAME. With its
 * digests and their spaces removed it is `### [ ] \`TX-EVENT-PAYLOAD-DIFF\``; the
 * `### [x] \`TX-GLOBALGUARD\`` this comment called the maximum is 24 and is nowhere near it. The
 * figure is in {@link CITED_READINGS} and a case derives it from the artefact rather than trusting
 * this sentence. Capitals are {@link TX_CAPITALS}, which is the entry id's kind and not this
 * position's, so the same id cannot be admitted here and refused where it stands alone.
 */
const AMENDMENT_LINE_BOUND: Extent = {
  chars: 96,
  segments: 10,
  perToken: 8,
  capitals: TX_CAPITALS,
};

/**
 * How many digests the whole artefact may carry.
 *
 * A VOLUME BOUND AND NOTHING MORE, stated as one. A digest is eight bytes a reader cannot read, and
 * the artefact carries 2,918 of them today, which is 23 KB of bits that only the generator
 * decides the meaning of. This bound permits four times that. It does not make the digests safe; it
 * makes a generator mistake finite. Most of them are the prefix digests of amendment headings, which
 * grow with the document, so the room is real rather than decorative.
 *
 * ONE DIMENSION OF THIS IS LOOSER THAN WHAT WENT BEFORE, AND IT IS DISCLOSED RATHER THAN LEFT TO BE
 * FOUND. The previous rules stripped the digest but not the space in front of it, so fifty digests
 * left fifty spaces and the CHARACTER bound of the amendment position happened to cap one line at
 * about 57 digests. That was an accident of a length measure rather than a stated rule, and it sat
 * seven above the fifty the longest heading already carries, so the next longer heading would have
 * reddened. The per line bound is now declared, at 200, and the accident is gone. Against it, the
 * total was UNBOUNDED: 9,935 amendment lines at 57 each is 566,000 digests, four and a half
 * megabytes, and nothing counted them. Bounding the total at 12,000 is about forty seven times
 * tighter on the quantity the bound exists for, and looser on one line taken alone.
 *
 * IT TRACKS THE DOCUMENT RATHER THAN A KIND, AND THAT IS SAID PLAINLY HERE INSTEAD OF BEING FOUND
 * LATER. 12,000 is four times the 2,918 the artefact carries, and the number it is four times moves
 * with ordinary writing: most of them are the prefix digests of amendment headings, one per word
 * boundary of a title, so one entry with a long title adds forty and a milestone of writing adds
 * several hundred. There is no property of the KIND that says how many digests a reading of four
 * documents ought to hold, so no honest derivation is available and this is a multiple of a
 * measurement, disclosed as one.
 *
 * WHAT MAKES THAT SAFE IS THAT IT IS NO LONGER THE BINDING NUMBER. 12,000 digests weigh 204,000
 * bytes at seventeen each, and {@link PROJECTION_ARTEFACT_BUDGET} refuses the file above 147,456,
 * so the byte budget goes red first and this count now names a channel rather than limiting one.
 */
export const DIGESTS_IN_THE_ARTEFACT = 12_000;

/** A leaf either belongs to the kinds it names, or is refused for the reason it gives. */
type Verdict = { readonly kinds: readonly ValueKind[] } | { readonly reason: string };

/** What one position of the artefact is allowed to hold, before its bound is applied. */
interface Grammar {
  /** What the position holds, in words, printed by every refusal. */
  readonly what: string;
  /** True when the value is a document rather than a token, so its bound is per line. */
  readonly perLine: boolean;
  readonly admits: (leaf: Leaf) => Verdict;
}

/** One position: its grammar, how far one value may reach, and how much may stand there. */
interface Position extends Grammar {
  /** How far one value, or one line of one, may reach. */
  readonly bound: Extent;
  /** Most leaves this position may hold over the whole artefact. */
  readonly leaves: number;
  /** Most lines one leaf may hold, and most over every leaf together. Absent unless `perLine`. */
  readonly lines?: { readonly perLeaf: number; readonly total: number };
  /** Most digests one line, or one whole value, may carry. */
  readonly digestsPerLine: number;
}

const shaped = (pattern: RegExp, kinds: readonly ValueKind[], what: string): Grammar => ({
  what,
  perLine: false,
  admits: (leaf) =>
    leaf.shape === 'string' || leaf.shape === 'number'
      ? pattern.test(leaf.text)
        ? { kinds }
        : { reason: `is not ${what}` }
      : { reason: `is ${leaf.shape} where this position holds ${what}` },
});

const linesOf = (
  patterns: readonly RegExp[],
  kinds: readonly ValueKind[],
  what: string,
): Grammar => ({
  what,
  perLine: true,
  admits: (leaf) => {
    if (leaf.shape !== 'string') {
      return { reason: `is ${leaf.shape} where this position holds lines, each of them ${what}` };
    }

    for (const [at, line] of documentLines(leaf.text).entries()) {
      if (patterns.some((pattern) => pattern.test(line))) continue;
      return { reason: `line ${String(at + 1)} is not ${what}: ${JSON.stringify(line)}` };
    }

    return { kinds };
  },
});

/**
 * The kinds one line of a projected stylesheet belongs to, or nothing when it belongs to none.
 *
 * @param line - One line
 * @returns The kinds, or undefined when no enumerated form matches
 */
function cssLineKinds(line: string): readonly ValueKind[] | undefined {
  if (line === '}' || IS_CSS_BLOCK_OPEN.test(line)) return ['identifier'];
  if (IS_CSS_INERT.test(line)) return ['identifier', 'number'];
  if (IS_CSS_MOTION.test(line)) return ['identifier', 'motion-value'];
  return undefined;
}

const FIGURES_WHAT = 'figures separated by " ; "';

/**
 * The figures one claim map row states, counted in code because the regex for it could not be.
 *
 * A REPETITION OF AN AMBIGUOUS ALTERNATION IS A HANG AND NOT A BOUND, which is measured rather than
 * feared: the first attempt at this bound wrote the count into the pattern, as
 * `FIGURE(?: ; FIGURE){0,135}`, and a value of 400 one digit figures did not finish in ten minutes.
 * A figure can be read as `\d{1,3}` or as `\d{1,9}`, so every figure doubles the ways the whole
 * value can be parsed, and a value the pattern must REFUSE makes the engine try them. Splitting on
 * the separator and testing one figure at a time is linear and says which figure was wrong.
 */
const figures: Grammar = {
  what: FIGURES_WHAT,
  perLine: false,
  admits: (leaf) => {
    if (leaf.shape !== 'string' && leaf.shape !== 'number') {
      return { reason: `is ${leaf.shape} where this position holds ${FIGURES_WHAT}` };
    }

    if (leaf.text === '') return { kinds: ['number'] };

    const parts = leaf.text.split(' ; ');
    if (parts.length > FIGURES_IN_A_ROW) {
      return {
        reason:
          `states ${String(parts.length)} figures against a bound of ` +
          `${String(FIGURES_IN_A_ROW)}, and a row of figures is a table of measurements rather ` +
          `than a paragraph`,
      };
    }

    for (const part of parts) {
      if (IS_FIGURE.test(part)) continue;
      return { reason: `is not ${FIGURES_WHAT}: ${JSON.stringify(part)} is not one` };
    }

    return { kinds: ['number'] };
  },
};

const STYLESHEET_WHAT = 'an enumerated selector, an inert declaration or a motion value';

const stylesheet: Grammar = {
  what: STYLESHEET_WHAT,
  perLine: true,
  admits: (leaf) => {
    if (leaf.shape !== 'string') {
      return { reason: `is ${leaf.shape} where this position holds a projected stylesheet` };
    }

    const kinds = new Set<ValueKind>();

    for (const [at, line] of leaf.text.split('\n').entries()) {
      const lineKinds = cssLineKinds(line);
      if (lineKinds === undefined) {
        return {
          reason: `line ${String(at + 1)} is none of ${STYLESHEET_WHAT}: ${JSON.stringify(line)}`,
        };
      }

      for (const kind of lineKinds) kinds.add(kind);
    }

    return { kinds: [...kinds] };
  },
};

/**
 * One position of the artefact: what it may hold, how far it may reach, and how much of it there
 * may be.
 *
 * @param bound - How far one value, or one line of one, may reach
 * @param leaves - Most leaves this position may hold over the whole artefact
 * @param grammar - What the position is allowed to hold
 * @param extra - Line and digest limits, for the positions that hold a document
 * @returns The position
 */
const holds = (
  bound: Extent,
  leaves: number,
  grammar: Grammar,
  extra?: {
    readonly lines?: { readonly perLeaf: number; readonly total: number };
    readonly digestsPerLine?: number;
  },
): Position => ({
  ...grammar,
  bound,
  leaves,
  ...(extra?.lines === undefined ? {} : { lines: extra.lines }),
  digestsPerLine: extra?.digestsPerLine ?? 1,
});

/**
 * Every position the artefact has, what each one is allowed to hold, and how much of it there may
 * be.
 *
 * ARRAY INDICES COLLAPSE TO `[]` AND THE TWO DYNAMIC KEY MAPS TO `*`, so the table is one entry per
 * kind of leaf rather than one per leaf. The dynamic keys are themselves leaves and are checked as
 * such, because a SPEC 21 row label and a milestone id are both read out of the configuration and
 * both end up as key names in the file.
 *
 * THE SECOND NUMBER IS THE VOLUME BOUND AND IT IS THE ONE THAT WAS MISSING. Every count here is
 * generous against the artefact as it stands, because its job is to make a generator mistake finite
 * rather than to track the documents: 53 claim map rows against 400, three stylesheets against 12,
 * 15 markers against 200.
 */
const RULES: Readonly<Record<string, Position>> = {
  version: holds(NUMBER_BOUND, 1, shaped(/^\d+$/u, ['number'], 'a version number')),
  integrity: holds(DIGEST_BOUND, 1, shaped(IS_DIGEST, ['digest'], 'a digest')),
  'data.documents[].file': holds(
    PATH_BOUND,
    24,
    shaped(IS_REPO_PATH, ['identifier'], 'a repository relative path'),
  ),
  'data.documents[].bytes': holds(NUMBER_BOUND, 24, shaped(/^\d+$/u, ['number'], 'a byte count')),
  'data.build': holds(
    BUILD_LINE_BOUND,
    1,
    linesOf(BUILD_LINES, ['identifier', 'box', 'digest'], 'a surrogate plan line'),
    // ONE DIGEST A LINE, WHICH USED TO BE TWO AND WAS SLACK NOTHING COULD REACH. Every one of the
    // four plan line forms carries at most one digest, and the file holds at most one, so the
    // second was a permission for a repetition the grammar above cannot produce.
    { lines: { perLeaf: 6_000, total: 6_000 }, digestsPerLine: 1 },
  ),
  'data.amendments': holds(
    AMENDMENT_LINE_BOUND,
    1,
    linesOf(AMENDMENT_LINES, ['identifier', 'box', 'digest'], 'a surrogate amendment line'),
    { lines: { perLeaf: 30_000, total: 30_000 }, digestsPerLine: 200 },
  ),
  'data.markers[].file': holds(
    PATH_BOUND,
    200,
    shaped(IS_REPO_PATH, ['identifier'], 'a repository relative path'),
  ),
  'data.markers[].line': holds(NUMBER_BOUND, 200, shaped(/^\d+$/u, ['number'], 'a line position')),
  'data.markers[].text': holds(
    MARKER_BOUND,
    200,
    shaped(
      IS_MARKER_TEXT,
      ['identifier'],
      `a marker written with ${DEFERRAL_WORD}, ${PROVENANCE_WORDS.join(' or ')}, or a bare milestone`,
    ),
  ),
  'data.markers[].kind': holds(
    KIND_BOUND,
    200,
    shaped(IS_MARKER_KIND, ['identifier'], 'one of the marker kinds'),
  ),
  'data.markers[].owner': holds(
    MILESTONE_BOUND,
    200,
    shaped(new RegExp(`^(?:${MILESTONE_ID})?$`, 'u'), ['identifier'], 'a milestone id or empty'),
  ),
  'data.markers[].entry': holds(
    ENTRY_BOUND,
    200,
    shaped(new RegExp(`^(?:${OWNED_ID})?$`, 'u'), ['identifier'], 'an amendment entry id or empty'),
  ),
  'data.spec.packages.published[]': holds(
    PACKAGE_BOUND,
    40,
    shaped(IS_PACKAGE, ['identifier'], 'a package name'),
  ),
  'data.spec.packages.internal[]': holds(
    PACKAGE_BOUND,
    40,
    shaped(IS_PACKAGE, ['identifier'], 'a package name'),
  ),
  'data.spec.packages.ecosystem[]': holds(
    PACKAGE_BOUND,
    40,
    shaped(IS_PACKAGE, ['identifier'], 'a package name'),
  ),
  'data.spec.securityClaims[].id': holds(
    CLAUSE_BOUND,
    120,
    shaped(IS_SPEC_CLAUSE, ['identifier'], 'a SPEC clause id'),
  ),
  'data.spec.securityClaims[].text': holds(
    DIGEST_BOUND,
    120,
    shaped(IS_DIGEST, ['digest'], 'a digest'),
  ),
  'data.spec.budgetRows[].label': holds(
    DIGEST_BOUND,
    200,
    shaped(IS_DIGEST, ['digest'], 'a digest'),
  ),
  'data.spec.budgetRows[].threshold': holds(
    THRESHOLD_BOUND,
    200,
    shaped(
      IS_THRESHOLD,
      ['identifier', 'number'],
      `a bound, a figure with a unit, or ${REPORT_MARKER}`,
    ),
  ),
  'data.spec.suiteRows.*': holds(
    SUITE_ROW_BOUND,
    40,
    shaped(IS_SUITE_ROW, ['identifier'], 'a SPEC 21 row label'),
  ),
  'data.spec.suiteRows.*[]': holds(DIGEST_BOUND, 600, shaped(IS_DIGEST, ['digest'], 'a digest')),
  'data.spec.milestoneClauses.*': holds(
    MILESTONE_BOUND,
    24,
    shaped(IS_MILESTONE, ['identifier'], 'a milestone id'),
  ),
  'data.spec.milestoneClauses.*[]': holds(
    DIGEST_BOUND,
    480,
    shaped(IS_DIGEST, ['digest'], 'a digest'),
  ),
  'data.spec.readerPages[]': holds(
    ROUTE_BOUND,
    60,
    shaped(IS_ROUTE, ['identifier'], 'a reader page route'),
  ),
  'data.claimMap[].id': holds(
    CLAIM_ID_BOUND,
    400,
    shaped(IS_CLAIM_ID, ['identifier'], 'a claim or budget id'),
  ),
  'data.claimMap[].text': holds(FIGURES_BOUND, 400, figures),
  'data.claimMap[].proofs[]': holds(
    PATH_BOUND,
    2_000,
    shaped(IS_REPO_PATH, ['identifier'], 'a repository relative path'),
  ),
  'data.claimMap[].status': holds(
    STATUS_BOUND,
    400,
    shaped(IS_CLAIM_STATUS, ['identifier'], 'proved or a task id'),
  ),
  'data.claimMap[].quoted': holds(
    DIGEST_BOUND,
    400,
    shaped(new RegExp(`^(?:${DIGEST})?$`, 'u'), ['digest'], 'a digest or empty'),
  ),
  'data.stylesheets[].file': holds(
    PATH_BOUND,
    12,
    shaped(IS_REPO_PATH, ['identifier'], 'a repository relative path'),
  ),
  'data.stylesheets[].css': holds(CSS_LINE_BOUND, 12, stylesheet, {
    lines: { perLeaf: 800, total: 4_800 },
    digestsPerLine: 0,
  }),
};

/** The paths whose keys are read out of the configuration rather than fixed by the interface. */
const DYNAMIC_KEY_PATHS = new Set(['data.spec.suiteRows', 'data.spec.milestoneClauses']);

/**
 * The positions `AiDocsProjectionData` declares as nullable, and the only ones a null may sit at.
 *
 * A NULL IS A LEAF AND USED TO BE A HOLE. The walk returned on one, so a key was never judged and
 * the path was never counted, and `data["a whole sentence"] = null` was invisible to the scan and
 * to the census that reconciles the scan with this table. It is now judged like every other shape,
 * against this list, which is read off the interface in `lib/projection.ts` by hand: a field that
 * becomes nullable and is not added here is red rather than quiet.
 */
const NULLABLE_PATHS = new Set([
  'data.documents[].bytes',
  'data.build',
  'data.amendments',
  'data.spec.packages',
  'data.spec.securityClaims',
  'data.spec.budgetRows',
  'data.spec.suiteRows.*',
  'data.spec.milestoneClauses.*',
  'data.spec.readerPages',
  'data.claimMap',
  'data.stylesheets[].css',
]);

/** Every position the rule table names, so a test can hold it to the artefact in both directions. */
export const PROJECTION_LEAF_PATHS: readonly string[] = Object.keys(RULES).sort();

/**
 * The reach bound every position takes, published so a test can hold the artefact to it.
 *
 * A READING THAT HAS GROWN PAST ONE OF THESE IS RED, and the answer then is to look at what grew
 * rather than to widen the number. What the record no longer is, and used to be, is the reading
 * itself: an artefact measured on one day and multiplied by 1.1 is a bound sized to a document
 * rather than to a kind, and every honest arrival then met it.
 */
export const PROJECTION_BOUNDS: Readonly<Record<string, Extent>> = Object.fromEntries(
  Object.entries(RULES).map(([path, position]) => [path, position.bound]),
);

/**
 * How much each position may hold, published beside the reach bounds for the same reason.
 */
export const PROJECTION_VOLUME_BOUNDS: Readonly<
  Record<string, { readonly leaves: number; readonly lines?: { perLeaf: number; total: number } }>
> = Object.fromEntries(
  Object.entries(RULES).map(([path, position]) => [
    path,
    position.lines === undefined
      ? { leaves: position.leaves }
      : { leaves: position.leaves, lines: position.lines },
  ]),
);

/**
 * Every figure the comments in this file state about the committed artefact, so a case derives it.
 *
 * THREE OF THEM WERE WRONG AT ONCE, WHICH IS WHY THIS IS A TABLE AND NOT A CAREFUL RETYPING. The
 * plan line bound said a CONTENTS line is 26 characters; it is 24. The amendment line bound named
 * `### [x] \`TX-GLOBALGUARD\`` at 24 as the longest line; the longest is
 * `### [ ] \`TX-EVENT-PAYLOAD-DIFF\`` at 31, and that id is not even the widest run of capitals.
 * The residue list said a claim id has one segment of room; the reading is 6 against a bound of 8,
 * which is two. A figure a person typed describes the day it was typed, and this is the fourth
 * round in which one of them was wrong. `projection.spec.ts` reads each of these off the artefact
 * with the same walk that enforces the bounds, so a sentence that stops being true goes red.
 */
export const CITED_READINGS: readonly {
  /** Position the figure is about. */
  readonly path: string;
  /** Which of the four measures it states. */
  readonly measure: keyof Extent;
  /** What the artefact reads, as the comment claims it. */
  readonly reading: number;
  /** Which sentence states it, so a red case says what to fix rather than only that it is wrong. */
  readonly cited: string;
}[] = [
  { path: 'data.build', measure: 'chars', reading: 24, cited: 'BUILD_LINE_BOUND' },
  { path: 'data.build', measure: 'capitals', reading: 7, cited: 'BUILD_LINE_BOUND, RELEASE' },
  { path: 'data.amendments', measure: 'chars', reading: 31, cited: 'AMENDMENT_LINE_BOUND' },
  {
    path: 'data.amendments',
    measure: 'capitals',
    reading: 11,
    cited: 'TX_CAPITALS, TX-GLOBALGUARD',
  },
  {
    path: 'data.markers[].entry',
    measure: 'capitals',
    reading: 8,
    cited: 'ENTRY_BOUND, TX-SURFACE-REGISTER',
  },
  {
    path: 'data.claimMap[].id',
    measure: 'segments',
    reading: 6,
    cited: 'ACKNOWLEDGED_RESIDUE, the claim id entry',
  },
  { path: 'data.claimMap[].text', measure: 'chars', reading: 574, cited: 'FIGURES_BOUND' },
  { path: 'data.claimMap[].text', measure: 'segments', reading: 115, cited: 'FIGURES_BOUND' },
  { path: 'data.claimMap[].proofs[]', measure: 'chars', reading: 68, cited: 'PATH_BOUND' },
  { path: 'data.claimMap[].proofs[]', measure: 'segments', reading: 10, cited: 'PATH_BOUND' },
  {
    path: 'data.documents[].file',
    measure: 'capitals',
    reading: 10,
    cited: 'PATH_BOUND, BUILD-AMENDMENTS',
  },
  {
    path: 'data.spec.packages.ecosystem[]',
    measure: 'chars',
    reading: 33,
    cited: 'PACKAGE_BOUND, @openref/collector-access-control',
  },
  { path: 'data.spec.readerPages[]', measure: 'chars', reading: 27, cited: 'ROUTE_BOUND' },
  {
    path: 'data.markers[].owner',
    measure: 'chars',
    reading: 8,
    cited: 'MILESTONE_BOUND, POST-1.0',
  },
  {
    path: 'data.stylesheets[].css',
    measure: 'chars',
    reading: 74,
    cited: 'CSS_LINE_BOUND, the easing curve',
  },
];

/**
 * What fits under the bounds as they stand, named so the next reviewer finds it written down.
 *
 * EACH ONE IS A CONSEQUENCE OF THE RULING AND NOT AN OVERSIGHT. A bound sized to what its kind can
 * legitimately be leaves room inside it, and an author spelling a sentence like an identifier can
 * use that room. Naming the room is the honest half; closing it would mean refusing the honest work
 * in the same shape, which is the trade this file is not allowed to make. Re-derived after every
 * change to the table above, by planting each one and reading the verdict.
 *
 * IT IS NOW COMPLETE BY CONSTRUCTION AND NOT BY DILIGENCE, which is the change this round makes to
 * it. A reviewer found four kinds of room this list did not mention: every numeric position, the
 * three path positions that are not `proofs[]`, the stylesheet lines, which are the largest word
 * channel in the file, and the `TX-` id sitting inside a marker. Residue a reviewer has to
 * discover is the thing naming exists to prevent, so `projection.spec.ts` holds every position in
 * {@link PROJECTION_LEAF_PATHS} that can hold a character to being named here, and only the six
 * that hold nothing but a digest are exempt.
 *
 * WHAT BOUNDS THE TOTAL OF ALL OF IT IS {@link PROJECTION_ARTEFACT_BUDGET} AND NOT THIS LIST. Each
 * entry below is room in one value or at one position; the reviewer's 4.72 MB was those rooms
 * multiplied together, and the file budget is what answers that.
 */
export const ACKNOWLEDGED_RESIDUE: readonly string[] = [
  'data.claimMap[].proofs[], data.documents[].file, data.markers[].file and ' +
    'data.stylesheets[].file: sixteen words spelled with slashes and dots, ending in something ' +
    'shaped like a file extension, 120 characters over 16 segments, or in one of the two ' +
    'enumerated names in EXTENSIONLESS_FILES. THE ENUMERATION ADDS NO ROOM: it is two fixed ' +
    'words, held to `git ls-files` in both directions, so the room here is what it was before, ' +
    'the dotted spelling. ONLY THE FIRST IS CLOSED BY ANYTHING ELSE: the `claims` gate refuses a ' +
    'proof path naming no file in the repository, and nothing asks that of the other three',
  'data.claimMap[].id: a hyphenated identifier of up to eight segments and 48 characters, which ' +
    'is a short sentence. The fullest real id, `client-js-sign-in-return-raw`, reads six ' +
    'segments, so the room is TWO segments wide and not the one this list used to claim',
  'data.markers[].entry, data.markers[].text and data.amendments: a run of up to sixteen capitals ' +
    'inside a `TX-` id, at all three, because the bound follows the kind. `TX-GLOBALGUARD` writes ' +
    'eleven and `TX-REDUCEDMOTION-CONTRACT` thirteen, so a compound of two words fits, and so ' +
    'does a four word sentence in capitals such as `NOPROXYUNTILM8`, which is what the twelve at ' +
    'two of those positions used to refuse and the sixteen at the third already admitted',
  'data.spec.readerPages[]: a route of up to eight hyphenated segments in 64 characters, because ' +
    'a route is a path and a path has segments. Closed by nothing else, and a four word phrase ' +
    'written as one path segment fits inside it',
  'data.spec.packages.published[], data.spec.packages.internal[] and ' +
    'data.spec.packages.ecosystem[]: a scoped name of up to six hyphenated parts, because an ' +
    'ecosystem collector already writes three. Closed by the `publish-list` gate, which holds all ' +
    'three lists to what npm would publish',
  'data.spec.suiteRows.*: two camel cased words, because a row called `RuntimeFacts` is exactly ' +
    'that and `Observability` has to be green',
  'data.stylesheets[].css: THE LARGEST WORD CHANNEL IN THE FILE, and it was not on this list. ' +
    'Eight hyphenated segments in 96 characters on each of 800 lines a sheet, 4,800 lines over ' +
    'twelve sheets, so `--four-word-sentence-here: 0;` conforms and 4,800 of them carry about ' +
    '38,000 words past every per value rule. What refuses that is the file budget and nothing at ' +
    'this position',
  'version, data.documents[].bytes and data.markers[].line: twelve digits each, and a digit is ' +
    'the one thing a character bound counts one for one. data.spec.securityClaims[].id takes a ' +
    'decimal clause in twelve, data.spec.budgetRows[].threshold a separated figure and a unit in ' +
    'twenty four, and data.claimMap[].text up to 136 figures inside 800 characters. This is what ' +
    'is LEFT after the milestone, revision and figure grammars closed the runs that carried 3.02 ' +
    "MB of the reviewer's payload",
  'data.markers[].kind, data.claimMap[].status, data.markers[].owner and ' +
    'data.spec.milestoneClauses.*: closed by enumeration rather than by a bound, and what is left ' +
    'inside the enumeration is a two digit milestone number and a three digit task number',
  'data.build: four enumerated line forms, and the room inside them is two four digit line ' +
    'positions, a three digit task number and a two digit milestone. A milestone heading written ' +
    'as words in capitals is refused by the capitals bound of twelve',
  'data.amendments: 200 digests on one line where a character bound used to permit about 57 by ' +
    'accident. See DIGESTS_IN_THE_ARTEFACT: the total went from unbounded to 12,000, and the file ' +
    'budget now refuses 12,000 of them before that count does, since they weigh 204,000 bytes',
];

/**
 * Whether a line found in a private document is one the projection is allowed to carry.
 *
 * THE SWEEP IN `projection.spec.ts` CALLS THIS RATHER THAN COPYING IT. Lines of the private
 * documents do travel into the artefact, and travel on purpose: the reduced motion contract is the
 * values, a milestone heading is its own name, and a projected sheet or plan that dropped them
 * would answer nothing. The sweep asserts that every line of a private document found in the
 * artefact is one of those forms, which is a question only this file can answer.
 *
 * IT USED TO ASK ABOUT STYLESHEET LINES ALONE, and the sweep only passed because it filtered
 * document lines to forty characters and up. `**RELEASE**` is eleven characters, is a line of the
 * surrogate plan rather than of a stylesheet, and travels verbatim.
 *
 * @param line - One line of a private document, trimmed
 * @returns True when the line is an enumerated form within its position's bound
 */
export function admitsProjectedLine(line: string): boolean {
  const within = (bound: Extent): boolean => overrunOf(extentOf(line), bound) === undefined;

  if (cssLineKinds(line) !== undefined) return within(CSS_LINE_BOUND);
  if (IS_CSS_SELECTOR_PART.test(line)) return within(CSS_LINE_BOUND);
  if (BUILD_LINES.some((pattern) => pattern.test(line))) return within(BUILD_LINE_BOUND);
  if (AMENDMENT_LINES.some((pattern) => pattern.test(line))) return within(AMENDMENT_LINE_BOUND);

  return false;
}

/**
 * What a tree would weigh written the way `writeProjection` writes one.
 *
 * FOR THE CALLERS THAT HOLD A TREE RATHER THAN A FILE, which is every case that plants one. Two
 * spaces and a trailing newline is what the writer produces; the committed file is 560 bytes
 * narrower than this because `gates:projection` runs prettier over it afterwards, measured, and
 * that difference is far under the granularity of the budget it is compared against.
 *
 * `JSON.stringify` answers `undefined` rather than a string for a value JSON cannot hold, which its
 * own type does not say. Such a value is reported as a leaf that did not come out of the artefact,
 * and this keeps the weight a number rather than the word undefined.
 *
 * @param value - The tree
 * @returns Its length in bytes
 */
function writtenLength(value: unknown): number {
  const text: unknown = JSON.stringify(value, null, 2);
  return Buffer.byteLength(`${typeof text === 'string' ? text : 'null'}\n`);
}

/**
 * Splits a value the way the generator wrote it, so a trailing newline adds no empty line.
 *
 * @param text - The whole value
 * @returns Its lines
 */
function documentLines(text: string): string[] {
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * Which of the four measures a value exceeded, in words, or nothing when it is inside all four.
 *
 * @param reach - What the value measures
 * @param bound - What the position allows
 * @returns The overrun, or undefined
 */
function overrunOf(reach: Extent, bound: Extent): string | undefined {
  if (reach.chars > bound.chars) {
    return `reaches ${String(reach.chars)} characters against a bound of ${String(bound.chars)}`;
  }

  if (reach.segments > bound.segments) {
    return `divides into ${String(reach.segments)} separator delimited segments against a bound of ${String(bound.segments)}`;
  }

  if (reach.perToken > bound.perToken) {
    return `packs ${String(reach.perToken)} segments into one token against a bound of ${String(bound.perToken)}`;
  }

  if (reach.capitals > bound.capitals) {
    return `writes ${String(reach.capitals)} capitals in one unbroken run against a bound of ${String(bound.capitals)}, and a run of capitals is the one thing segmentation cannot divide`;
  }

  return undefined;
}

/**
 * Walks the whole artefact and reports every leaf that is not one of the allowed kinds.
 *
 * THE WEIGHT OF THE FILE IS CHECKED HERE AND NOT ONLY IN THE GATE, so that every caller gets the
 * one bound the per position rules cannot express. A caller holding the committed file passes its
 * size; a caller holding a planted tree passes nothing and the writer's serialization is measured
 * instead, which is what such a tree would weigh if it were written.
 *
 * @param artefact - The parsed artefact, or any subtree of it
 * @param bytes - What the file weighs, when the caller read it from disk
 * @returns The findings, how many leaves were read, and which kinds of value they were
 */
export function scanProjectionProse(artefact: unknown, bytes?: number): ProseScan {
  const findings: ProseFinding[] = [];
  const kinds = new Set<ValueKind>();
  const paths = new Set<string>();
  const absences = new Set<string>();
  const reach: Record<string, Extent> = {};
  const volume: Record<string, Volume> = {};
  let leaves = 0;
  let digests = 0;

  const unnamed = (path: string, value: string): void => {
    findings.push({
      rule: 'leaf-refused',
      path,
      value,
      reason:
        'sits at a path no rule names. A field added to the projection is given a grammar in ' +
        'lib/projection-prose.ts before the artefact may carry it, and a key is a leaf, so this ' +
        'reports the name as well as the value beside it',
    });
  };

  const count = (path: string, lines: number): void => {
    const seen = volume[path];
    volume[path] = {
      leaves: (seen?.leaves ?? 0) + 1,
      mostLines: Math.max(seen?.mostLines ?? 0, lines),
      lines: (seen?.lines ?? 0) + lines,
    };
  };

  const measure = (path: string, position: Position, value: string): string | undefined => {
    const parts = position.perLine ? documentLines(value) : [value];

    count(path, parts.length);

    let overrun: string | undefined;

    for (const [at, part] of parts.entries()) {
      const extent = extentOf(part);
      const seen = reach[path];
      reach[path] = {
        chars: Math.max(seen?.chars ?? 0, extent.chars),
        segments: Math.max(seen?.segments ?? 0, extent.segments),
        perToken: Math.max(seen?.perToken ?? 0, extent.perToken),
        capitals: Math.max(seen?.capitals ?? 0, extent.capitals),
      };

      const found = digestsIn(part);
      digests += found.count;

      const over =
        found.wrong.length > 0
          ? `carries ${JSON.stringify(found.wrong[0] ?? '')}, which is shaped like a digest and is ` +
            `not one. A digest is sixteen lowercase hex characters and nothing else, so anything ` +
            `else under a # is arbitrary bits that the strip before measurement would have hidden`
          : found.count > position.digestsPerLine
            ? `carries ${String(found.count)} digests against a bound of ${String(position.digestsPerLine)}, ` +
              `and a digest is eight bytes no reader can read`
            : overrunOf(extent, position.bound);

      if (over === undefined || overrun !== undefined) continue;

      overrun =
        `${position.perLine ? `line ${String(at + 1)} ` : ''}${over}. A value that reaches ` +
        `further than what ${position.what} can be is a sentence written with separators rather ` +
        `than one: ${JSON.stringify(part)}`;
    }

    return overrun;
  };

  const judge = (path: string, leaf: Leaf): void => {
    leaves += 1;

    if (leaf.shape === 'null' || leaf.shape === 'empty array' || leaf.shape === 'empty object') {
      absences.add(`${path}: ${leaf.shape}`);

      if (leaf.shape === 'null' ? NULLABLE_PATHS.has(path) : isContainer(path)) return;
      if (RULES[path] === undefined) {
        unnamed(path, leaf.shape);
        return;
      }

      findings.push({
        rule: 'leaf-refused',
        path,
        value: leaf.shape,
        reason:
          `is ${leaf.shape} at a position no interface declares that way. A leaf holding nothing ` +
          `is still a leaf and its name is still a name`,
      });
      return;
    }

    paths.add(path);

    const position = RULES[path];
    if (position === undefined) {
      unnamed(path, leaf.text);
      return;
    }

    const verdict = position.admits(leaf);
    if ('reason' in verdict) {
      count(path, 1);
      findings.push({ rule: 'leaf-refused', path, value: leaf.text, reason: verdict.reason });
      return;
    }

    const overrun = measure(path, position, leaf.text);
    if (overrun !== undefined) {
      findings.push({ rule: 'leaf-refused', path, value: leaf.text, reason: overrun });
      return;
    }

    for (const kind of verdict.kinds) kinds.add(kind);
  };

  const walk = (value: unknown, path: string): void => {
    if (value === null || value === undefined) {
      judge(path, { shape: 'null', text: '' });
      return;
    }

    if (Array.isArray(value)) {
      if (value.length === 0) {
        judge(path, { shape: 'empty array', text: '' });
        return;
      }

      for (const item of value) walk(item, `${path}[]`);
      return;
    }

    if (typeof value === 'object') {
      const entries = Object.entries(value);
      if (entries.length === 0) {
        judge(path, { shape: 'empty object', text: '' });
        return;
      }

      for (const [key, item] of entries) {
        if (DYNAMIC_KEY_PATHS.has(path)) {
          judge(`${path}.*`, { shape: 'string', text: key });
          walk(item, `${path}.*`);
          continue;
        }

        walk(item, path === '' ? key : `${path}.${key}`);
      }
      return;
    }

    if (typeof value === 'boolean') {
      judge(path, { shape: 'boolean', text: String(value) });
      return;
    }

    if (typeof value === 'string') {
      judge(path, { shape: 'string', text: value });
      return;
    }

    if (typeof value === 'number') {
      judge(path, { shape: 'number', text: String(value) });
      return;
    }

    // Nothing else survives `JSON.parse`, so a leaf that gets here came from a caller passing
    // something other than a parsed artefact. It is reported rather than skipped, for the same
    // reason a missing artefact is an error and never a skip.
    leaves += 1;
    findings.push({
      rule: 'leaf-refused',
      path,
      value: typeof value,
      reason: 'is a value JSON cannot hold, so it did not come out of the committed artefact',
    });
  };

  walk(artefact, '');

  const weight = bytes ?? writtenLength(artefact);
  findings.push(...volumeFindings(volume, digests, weight, leaves));

  return {
    findings,
    leaves,
    kinds: [...kinds].sort(),
    paths: [...paths].sort(),
    absences: [...absences].sort(),
    reach,
    volume,
    digests,
    bytes: weight,
  };
}

/**
 * Whether the artefact holds more of anything than its position permits, and more than the whole
 * file is allowed whatever the positions say.
 *
 * THIS IS THE HALF NO PER VALUE RULE CAN DO. A thousand conforming lines of CSS custom properties
 * are a thousand conforming lines, and each one passes its grammar and its bound; twelve thousand
 * words arrive anyway. The count is the only thing that sees it.
 *
 * AND THE POSITION COUNTS ARE THE HALF THAT COULD NOT DO IT EITHER, WHICH IS WHY THE LAST TWO
 * CHECKS HERE ARE ABOUT THE FILE. Thirty one positions each holding a defensible number of
 * defensible values is 4.72 MB. Nothing below the file can see that.
 *
 * @param volume - How much stood at each position
 * @param digests - How many digests the whole artefact carried
 * @param bytes - What the whole file weighs
 * @param leaves - How many leaves it holds over every position together
 * @returns One finding per position that holds too much, and per whole file bound that is passed
 */
function volumeFindings(
  volume: Readonly<Record<string, Volume>>,
  digests: number,
  bytes: number,
  leaves: number,
): ProseFinding[] {
  const findings: ProseFinding[] = [];

  for (const [path, seen] of Object.entries(volume).sort()) {
    const position = RULES[path];
    if (position === undefined) continue;

    if (seen.leaves > position.leaves) {
      findings.push({
        rule: 'volume-exceeded',
        path,
        value: `${String(seen.leaves)} leaves`,
        reason:
          `holds ${String(seen.leaves)} leaves against a bound of ${String(position.leaves)}. ` +
          `Volume is the half a grammar cannot see: every one of them may be a conforming value ` +
          `and the repetition still carries what one of them cannot`,
      });
    }

    const lines = position.lines;
    if (lines === undefined) continue;

    if (seen.mostLines > lines.perLeaf) {
      findings.push({
        rule: 'volume-exceeded',
        path,
        value: `${String(seen.mostLines)} lines in one value`,
        reason: `holds ${String(seen.mostLines)} lines in one value against a bound of ${String(lines.perLeaf)}`,
      });
      // The total is not reported beside it. A position holding one leaf, which is what the two
      // surrogate documents are, would otherwise report the same overrun twice under two names.
      continue;
    }

    if (seen.lines > lines.total) {
      findings.push({
        rule: 'volume-exceeded',
        path,
        value: `${String(seen.lines)} lines in all`,
        reason: `holds ${String(seen.lines)} lines over every value at this position against a bound of ${String(lines.total)}`,
      });
    }
  }

  if (bytes > PROJECTION_ARTEFACT_BUDGET.limitBytes) {
    findings.push({
      rule: 'volume-exceeded',
      path: 'the whole artefact',
      value: `${String(bytes)} bytes`,
      reason:
        `weighs ${String(bytes)} bytes against a budget of ` +
        `${String(PROJECTION_ARTEFACT_BUDGET.limitBytes)}. THE PER POSITION BOUNDS CANNOT SAY THIS, ` +
        `BECAUSE THEY MULTIPLY: every position filled to exactly its own limit weighs 4,725,296 ` +
        `bytes with nothing over anywhere. Look at what grew rather than at this number`,
    });
  }

  if (leaves > PROJECTION_ARTEFACT_BUDGET.leaves) {
    findings.push({
      rule: 'volume-exceeded',
      path: 'the whole artefact',
      value: `${String(leaves)} leaves`,
      reason:
        `holds ${String(leaves)} leaves over every position together against a budget of ` +
        `${String(PROJECTION_ARTEFACT_BUDGET.leaves)}. Bytes alone would admit the same volume ` +
        `spread over more, shorter values. THIS IS THE CEILING OF A CORRIDOR whose floor is ` +
        `${String(PROJECTION_LEAF_FLOOR)}, the count under which the artefact is an absence rather ` +
        `than a reading, and the committed reading sits between the two. THE ANSWER TO REACHING ` +
        `THIS IS TO RE-DERIVE IT the way PROJECTION_ARTEFACT_BUDGET's own comment derives it, by ` +
        `pricing a milestone off the artefact and covering the milestones the plan still holds, ` +
        `and never to raise it to fit the reading that just went red`,
    });
  }

  if (digests > DIGESTS_IN_THE_ARTEFACT) {
    findings.push({
      rule: 'volume-exceeded',
      path: 'the whole artefact',
      value: `${String(digests)} digests`,
      reason:
        `the artefact carries ${String(digests)} digests against a bound of ` +
        `${String(DIGESTS_IN_THE_ARTEFACT)}. Each one is eight bytes nobody can read, so their ` +
        `number is the size of what a changed generator could put through them`,
    });
  }

  return findings;
}

/**
 * Whether a position holds other positions, derived from the rule table rather than listed again.
 *
 * An empty array or an empty object is admitted where the table names something beneath it, and is
 * a finding anywhere else, which is what makes `data["a whole sentence"] = []` visible.
 *
 * @param path - The position
 * @returns True when some rule sits beneath it
 */
function isContainer(path: string): boolean {
  if (path === '') return true;

  return PROJECTION_LEAF_PATHS.some(
    (leaf) => leaf.startsWith(`${path}.`) || leaf.startsWith(`${path}[]`),
  );
}
