/**
 * What the gates read out of `ai-docs/`, as committed data rather than as prose.
 *
 * THE DEFECT THIS REPLACES. `ai-docs/` is excluded from git in `.git/info/exclude`, so no clone
 * restores it and no runner has it. Fourteen gates named `ai-docs-absent` as a reason they may
 * skip and TWELVE of them actually did, on every CI run. Half the project's guarantees ran on one
 * laptop, by construction rather than by accident, and a skip that is expected on every clone is a
 * skip nobody reads. The three numbers this change is described by, and which of them counts what,
 * are set out in `lib/skip-accounting.ts`; how many gates may still skip is printed by `index.ts`
 * off `SKIP_REASONS` rather than written down anywhere, because the count of the whole list moves
 * whenever a gate is added and a total written into a sentence is the drift this slice spent a
 * round on.
 *
 * THE ANSWER, AND WHAT IT IS NOT. Whatever a gate needs from those documents becomes a generated
 * artefact that ships in the repository, and the gate reads the artefact rather than the document.
 * It is NOT a copy of the documents: the exclusion stands. What ships is data, in a closed set of
 * forms that is not listed here and never was worth listing twice: `lib/projection-prose.ts` holds
 * the grammar of every position the file has, `tools/gates/README.md` publishes the vocabulary
 * those grammars classify a leaf into, and a test reconciles the two with the artefact itself. A
 * hand written list in this comment would be a third copy and the first to go stale.
 *
 * NO SENTENCE OF THE PRIVATE DOCUMENTS SHIPS. Every free text a gate compares, a task title, an
 * amendment heading, a SPEC 19 promise, a SPEC 21 coverage name, a SPEC 22 clause, a SPEC 20 row
 * label, travels as {@link digestOf} and nothing else. Equality between two texts survives a
 * digest exactly; the words do not survive it at all. Where a gate needs to PRINT the text it
 * compared, it resolves the digest back through the committed constant that already carries the
 * same words, and where no committed constant carries them it prints the digest and names the
 * document, which is a poorer message and the same verdict.
 *
 * A STALE ARTEFACT IS A RED BUILD WHERE `ai-docs/` IS PRESENT, AND A WARNING WHERE IT IS NOT. Say
 * it with the condition, because the sentence without it was false on every clone. Two mechanisms,
 * because the two failures are different, and neither reaches as far as the shorter sentence
 * claimed:
 *
 * - A CORRUPTED ARTEFACT FAILS EVERYWHERE, AND CORRUPTION IS ALL {@link integrityOf} DETECTS. It is
 *   recomputed on every read and the file carries it, so a truncated write, a merge that mangled
 *   the JSON, or a value changed by a hand that did not know about the digest all fail on any
 *   checkout. IT IS NOT A TAMPER CHECK. The digest is computed by this file from the data beside
 *   it, with no secret anywhere, so anybody editing the artefact on purpose recomputes it and the
 *   file passes. What stands against a deliberate edit is the comparison below and code review, not
 *   this digest.
 * - A DOCUMENT EDITED WITHOUT REGENERATING FAILS WHEREVER THE DOCUMENTS ARE, which is the
 *   maintainer's machine: `build-manifest` re-runs this projection over the real files and compares
 *   it with the committed one, byte for byte in canonical form. On a clone that comparison cannot
 *   be made by anybody, and `build-manifest` reports that in a WARNING THAT DOES NOT COLOUR THE
 *   VERDICT. So a clone can be green over an artefact that no longer matches the documents, and
 *   the maintainer's tree is where that goes red.
 *
 * Neither can be answered by a checkout that has neither the documents nor a readable artefact, so
 * a missing or unreadable artefact is an ERROR in every gate that reads it, never a skip.
 *
 * THE SURROGATE DOCUMENTS ARE THE ONE THING HERE THAT LOOKS LIKE A COPY AND IS NOT. `BUILD.md`'s
 * whole contract is that CONTENTS line `L0268-L0288` addresses the task whose heading is on line
 * 268, so the check is about line POSITIONS and there is no way to project it into a record. What
 * ships is a file of the same line count in which the CONTENTS lines, the milestone lines and the
 * task headings stand at their original line numbers with their titles replaced by digests, and
 * every other line is empty. Every fact `checkBuildManifest` reads survives; nothing anybody wrote
 * does. The amendments surrogate is the same idea over the two heading forms and the milestone
 * line, plus a blank heading for every other heading, because a heading is what ends an entry's
 * body and dropping one would re-home the milestone line under it.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ClaimMapRow, SpecClaim } from './claims.js';
import {
  boundDirectionOfCell,
  normalizeQuote,
  parseBudgetRows,
  parseClaimMap,
  parseSecurityClaims,
} from './claims.js';
import type { DeferralMarker } from './deferrals.js';
import { findMarkers } from './deferrals.js';
import { MOTION_TOKENS, readBlocks } from './motion-tokens.js';
import type { SpecPackageLists } from './publish-list.js';
import { readSpecPackageLists } from './publish-list.js';
import { readerPagesOf } from './reader-pages.js';
import { milestoneClausesOf, suiteRowOf } from './static-suites.js';

/** Where the generated artefact lives, repository relative. */
export const PROJECTION_FILE = 'tools/gates/ai-docs-projection.json';

/** The command that regenerates it, named in every message that reports it stale. */
export const PROJECTION_COMMAND = 'pnpm gates:projection';

/**
 * Shape of the artefact, bumped when a field changes meaning.
 *
 * A gate reading a version it does not know refuses rather than guessing, because an older
 * artefact answering a newer question is the silent pass this whole file exists against.
 *
 * BUMPED TO 2 ON 2026-09-04, WHEN `SpecPackageLists` GAINED ITS HELD BACK SET. A version 1 artefact
 * carries no such member, so the gate that reconciles it would read `undefined`, and while the
 * comparison would then fail rather than pass, it would fail naming a document that says nothing
 * wrong. The refusal above names the command that fixes it, which is the accurate answer.
 */
export const PROJECTION_VERSION = 2;

/**
 * How many distinct digests the committed artefact carries.
 *
 * COUNTED RATHER THAN CALLED A FEW THOUSAND, because the collision figure below is derived from it
 * and a figure derived from an estimate is an estimate. `projection.spec.ts` counts them in the
 * committed file with {@link distinctDigestsIn} and holds the count to this, and holds the odds in
 * the comment below to the arithmetic on it, so neither can drift without going red.
 */
export const PROJECTION_DISTINCT_DIGESTS = 2438;

/**
 * How many distinct digests a text carries, so the collision figure is measured and not guessed.
 *
 * @param text - The artefact as it is committed, or any text
 * @returns How many distinct digests it holds
 */
export function distinctDigestsIn(text: string): number {
  return new Set(text.match(/#[0-9a-f]{16}/gu) ?? []).size;
}

/**
 * A text reduced to what a comparison should be sensitive to, and nothing a reader could use.
 *
 * SIXTEEN HEX CHARACTERS, WHICH IS SIXTY FOUR BITS. At the {@link PROJECTION_DISTINCT_DIGESTS} the
 * artefact carries, the chance that any two of them collide is n(n-1)/2 over 2 to the 64th, which
 * is one in 6.2e12. THE FIGURE THIS REPLACES SAID ONE IN TEN TO THE ELEVENTH and was written
 * against "a few thousand" rather than against a count, so it could not be reproduced from anything
 * in the repository; it erred safe, which is not the same as being right, and a figure nobody can
 * re-derive is the class this slice is otherwise about. A collision would make one comparison pass
 * that should have failed, and the alternative, a full digest, triples the size of the file for a
 * risk already smaller than the chance of the file being wrong for a reason nobody thought of.
 *
 * @param text - The text whose wording is the subject of a check
 * @returns The digest, marked so a reader of the artefact knows what it is looking at
 */
export function digestOf(text: string): string {
  return `#${createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16)}`;
}

/** One required document, reduced to the question `checkRequiredDocs` asks of it. */
export interface ProjectedDocument {
  readonly file: string;
  /** Size when the artefact was generated, null when the file could not be read at all. */
  readonly bytes: number | null;
}

/** One theme stylesheet, reduced to the blocks and values the motion contract reads. */
export interface ProjectedStylesheet {
  readonly file: string;
  /** The reduced stylesheet, null when the file was not there to read. */
  readonly css: string | null;
}

/** What the specification states, as data. */
export interface ProjectedSpec {
  /** SPEC 4's three package lists, null when the section could not be read. */
  readonly packages: SpecPackageLists | null;
  /** SPEC 19's promises, each `text` a digest. Null when the section is absent. */
  readonly securityClaims: readonly SpecClaim[] | null;
  /** SPEC 20's rows, each `label` a digest and each `threshold` its present tense segment. */
  readonly budgetRows: readonly { readonly label: string; readonly threshold: string }[] | null;
  /** Per SPEC 21 row label, the digests of the coverage names it states, null when absent. */
  readonly suiteRows: Readonly<Record<string, readonly string[] | null>>;
  /** Per milestone, the digests of its SPEC 22 done-when clauses, null when absent. */
  readonly milestoneClauses: Readonly<Record<string, readonly string[] | null>>;
  /** SPEC 13.3's reader page routes, null when the line is absent. */
  readonly readerPages: readonly string[] | null;
}

/** Everything the gates read, with nothing in it a person wrote. */
export interface AiDocsProjectionData {
  readonly documents: readonly ProjectedDocument[];
  /** Surrogate `BUILD.md`, null when the file could not be read. */
  readonly build: string | null;
  /** Surrogate `BUILD-AMENDMENTS.md`, null when the file could not be read. */
  readonly amendments: string | null;
  /** Every parenthesised milestone found in the documents, in the closed marker vocabulary. */
  readonly markers: readonly DeferralMarker[];
  readonly spec: ProjectedSpec;
  /** The claim map's rows, with prose reduced to its figures and the quote to a digest. */
  readonly claimMap: readonly ClaimMapRow[] | null;
  readonly stylesheets: readonly ProjectedStylesheet[];
}

/** The artefact as it is committed. */
export interface AiDocsProjection {
  readonly version: number;
  readonly data: AiDocsProjectionData;
  /** Digest of the canonical form of `data`, so a hand edit fails on every checkout. */
  readonly integrity: string;
}

/** What the generator has to be told, so this file does not carry a second copy of the config. */
export interface ProjectionRequest {
  /** Repository relative documents swept for deferral markers, in order. */
  readonly deferralDocuments: readonly string[];
  /** Repository relative documents whose presence and size `build-manifest` checks. */
  readonly requiredDocuments: readonly string[];
  /** SPEC 21 row labels any gate reads. */
  readonly suiteRows: readonly string[];
  /** Milestones whose SPEC 22 definition of done any gate reads. */
  readonly milestones: readonly string[];
  /** Repository relative theme stylesheets under `ai-docs/`. */
  readonly stylesheets: readonly string[];
}

/** Reading a file, injected so the projection can be built in a test without a filesystem. */
export type FileReader = (file: string) => string | undefined;

/** Sizing a file, injected for the same reason. */
export type FileSizer = (file: string) => number | undefined;

const BUILD_FILE = 'ai-docs/BUILD.md';
const AMENDMENTS_FILE = 'ai-docs/BUILD-AMENDMENTS.md';
const SPEC_FILE = 'ai-docs/SPEC.md';
const CLAIM_MAP_FILE = 'ai-docs/CLAIM-MAP.md';

/** The words a SPEC 20 cell uses for a figure that is recorded and gated by nothing. */
const REPORT_MARKER = 'порога нет';

const CONTENTS_LINE = /^- \[([ x])\] `(T\d{3})` +L(\d{4})-L(\d{4}) +(.+?) *$/;
const TASK_HEADING_LINE = /^### (T\d{3}) \[([ x])\] (.+?) *$/;
const MILESTONE_LINE = /^\*\*([A-Z][A-Z0-9]*)(?: - (.+?))?\*\*$/;
const AMENDMENT_SECTION_LINE = /^### \[([ x])\] `(T\d{3})`(?: +(.*?))? *$/;
const OWNED_ENTRY_LINE = /^### \[([ x])\] `((?:T\d{3}-R\d*)|(?:TX-[A-Z-]+))`(?: +(.*?))? *$/;
const ENTRY_MILESTONE_LINE = /^\*\*Milestone:\*\* (M\d+|RELEASE|POST-1\.0)\b/;
const ANY_HEADING_LINE = /^(#{2,3}) /;

/**
 * Splits a file the way `wc -l` counts it, so a surrogate has the same line count as its source.
 *
 * @param text - Whole file contents
 * @returns One entry per line, index 0 holding line 1
 */
function linesOf(text: string): string[] {
  const lines = text.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * Every prefix of a heading that ends where a word ends.
 *
 * `m7-suites` asks whether an amendment heading BEGINS with a phrase its configuration spells,
 * and a digest of the whole heading cannot answer that. So the surrogate heading carries the
 * digest of every prefix that ends at a word boundary, and the question becomes whether the
 * digest of the phrase is among them. The two differ on a phrase that ends mid word, where this
 * answers no and `startsWith` answers yes: that direction is red rather than green, which is the
 * safe one for a gate.
 *
 * @param title - The heading as written
 * @returns Prefix digests, outermost last, always including the whole heading
 */
function prefixDigests(title: string): string[] {
  const digests: string[] = [];
  const isWord = (character: string): boolean => /[\p{L}\p{N}_]/u.test(character);

  for (let at = 1; at <= title.length; at += 1) {
    const before = title[at - 1] ?? '';
    const after = title[at];
    if (after !== undefined && isWord(before) === isWord(after)) continue;
    digests.push(digestOf(title.slice(0, at)));
  }

  return digests;
}

/**
 * A surrogate `BUILD.md`: the same lines in the same places, with nobody's words in them.
 *
 * @param text - The real document
 * @returns A document of the same line count that answers the same questions
 */
export function projectBuild(text: string): string {
  return linesOf(text)
    .map((line) => {
      const contents = CONTENTS_LINE.exec(line);
      if (contents !== null) {
        return `- [${contents[1] ?? ' '}] \`${contents[2] ?? ''}\` L${contents[3] ?? ''}-L${contents[4] ?? ''} ${digestOf(contents[5] ?? '')}`;
      }

      const heading = TASK_HEADING_LINE.exec(line);
      if (heading !== null) {
        return `### ${heading[1] ?? ''} [${heading[2] ?? ' '}] ${digestOf(heading[3] ?? '')}`;
      }

      const milestone = MILESTONE_LINE.exec(line);
      if (milestone !== null) {
        const label = milestone[2];
        return label === undefined
          ? `**${milestone[1] ?? ''}**`
          : `**${milestone[1] ?? ''} - ${digestOf(label)}**`;
      }

      return '';
    })
    .join('\n')
    .concat('\n');
}

/**
 * A surrogate `BUILD-AMENDMENTS.md`.
 *
 * EVERY HEADING IS REPRODUCED AND NOT ONLY THE TWO THAT CARRY IDS. A heading is what ends an
 * entry's body, so a chapter heading dropped from the surrogate would let the next entry's
 * `**Milestone:**` line be read as the previous entry's, which is a milestone moved by the
 * projection rather than by anybody.
 *
 * @param text - The real document
 * @returns A document of the same line count that answers the same questions
 */
export function projectAmendments(text: string): string {
  return linesOf(text)
    .map((line) => {
      const section = AMENDMENT_SECTION_LINE.exec(line);
      if (section !== null) {
        const title = section[3] ?? '';
        const words = [digestOf(title), ...prefixDigests(title)].join(' ');
        return `### [${section[1] ?? ' '}] \`${section[2] ?? ''}\` ${words}`;
      }

      const owned = OWNED_ENTRY_LINE.exec(line);
      if (owned !== null) {
        return `### [${owned[1] ?? ' '}] \`${owned[2] ?? ''}\` ${digestOf(owned[3] ?? '')}`;
      }

      const milestone = ENTRY_MILESTONE_LINE.exec(line);
      if (milestone !== null) return `**Milestone:** ${milestone[1] ?? ''}`;

      const heading = ANY_HEADING_LINE.exec(line);
      if (heading !== null) return `${heading[1] ?? '##'} ${digestOf(line)}`;

      return '';
    })
    .join('\n')
    .concat('\n');
}

/**
 * The present tense of one SPEC 20 threshold cell, without the history written after it.
 *
 * `thresholdOfCell` reads the segment before the first comma or parenthesis and the paragraphs
 * after it may name any figure they like, so that leading segment is the whole of what a check
 * reads. The one thing that lives outside it is the marker for a row that is recorded and gated by
 * nothing, which several rows write after the comma.
 *
 * THE MARKER USED TO WIN THE WHOLE CELL AND THAT DROPPED A BOUND. Two checks read this cell, not
 * one: `thresholdOfCell` answers `report` for any cell carrying the marker wherever it sits, and
 * `boundDirectionOfCell` reads the leading segment for an operator. A cell spelling both, `>= 3,
 * порога нет`, projected to the marker alone, and the projected cell then answered `unstated` where
 * the document answered `at-least`, so `budget-bound-inverted` saw a ceiling where the table stated
 * a floor. No row in SPEC 20 spells both today, which makes it a defect in the shape of this
 * function rather than in the artefact, and the shape is what is fixed: the operator survives
 * beside the marker. Only the operator does, out of the enumerated set `boundDirectionOfCell`
 * reads, because the leading segment of the rows that write the marker is a sentence and the whole
 * point of the projection is that no sentence travels.
 *
 * @param cell - The threshold cell as the table writes it
 * @returns The part a check reads
 */
export function projectThresholdCell(cell: string): string {
  const leading = (cell.split(/[,(]/, 1)[0] ?? '').trim();

  if (!cell.includes(REPORT_MARKER)) return leading;

  const direction = boundDirectionOfCell(cell);
  if (direction === 'at-least') return `≥ ${REPORT_MARKER}`;
  if (direction === 'at-most') return `≤ ${REPORT_MARKER}`;

  return REPORT_MARKER;
}

/**
 * The figures one claim map cell states, with the prose between them removed.
 *
 * `checkClaimFigures` asks whether a row states the number the gate enforces, in one of the
 * spellings a budget is written in. Every one of those spellings is a run of digits and an
 * optional unit, so a cell reduces to its figures with no loss to that question and no sentence
 * kept. The separator is a character that begins no figure and ends none, so a figure at the seam
 * of two extracts reads exactly as it read in the cell.
 *
 * @param cell - The bounds cell as the map writes it
 * @returns The figures it states, in order
 */
export function projectFigures(cell: string): string {
  const figures = [...cell.matchAll(/(\d[\d,]*(?:\.\d+)?)(\s*(?:bytes|KB|MB|s)\b)?/gu)].map(
    (match) => `${match[1] ?? ''}${(match[2] ?? '').replace(/\s+/gu, ' ')}`,
  );

  return figures.join(' ; ');
}

/**
 * One theme stylesheet reduced to the motion contract's material.
 *
 * WHAT IS KEPT AND WHY EACH PART OF IT HAS TO BE. Every block that declares a custom property is
 * kept, because a block is what `prefers-reduced-motion` is counted in and a dropped one is a
 * theme that looks as though it answers nothing. Every custom property NAME is kept, because
 * whether a theme declares any token at all decides which of two messages a failure gets. Only
 * the motion tokens and whatever they alias through carry their VALUES, because those are the
 * only values resolved; every other property is written as `0`, a value nothing reads.
 *
 * @param css - The stylesheet
 * @returns A stylesheet that answers the same questions with none of the design in it
 */
export function projectStylesheet(css: string): string {
  const blocks = readBlocks(css);
  const resolved = new Set<string>(MOTION_TOKENS);

  for (let pass = 0; pass < 32; pass += 1) {
    const before = resolved.size;

    for (const block of blocks) {
      for (const [name, value] of block.declarations) {
        if (!resolved.has(name)) continue;
        for (const reference of value.matchAll(/var\(\s*(--[\w-]+)/gu)) {
          resolved.add(reference[1] ?? '');
        }
      }
    }

    if (resolved.size === before) break;
  }

  const lines: string[] = [];

  for (const block of blocks) {
    const parts = block.parts.length === 0 ? [''] : block.parts;
    for (const part of parts) lines.push(`${part} {`);

    for (const [name, value] of block.declarations) {
      lines.push(`${name}: ${resolved.has(name) ? value : '0'};`);
    }

    for (const _ of parts) lines.push('}');
  }

  return lines.join('\n');
}

/**
 * Reads every document once and writes down what the gates ask of it.
 *
 * IT VALIDATES NOTHING, AND THAT IS THE RULE THIS FUNCTION IS WRITTEN AROUND. A generator that
 * refused to record an inconsistent document would answer the gate's question before the gate
 * asked it, and the artefact would then prove that the generator agreed with itself. Every check
 * stays in the gate and runs over this, so a plan that stops being self consistent produces an
 * artefact that goes red on every clone.
 *
 * @param request - Which documents and which rows, taken from the gate configuration
 * @param read - Reads a repository relative file, undefined when it is not there
 * @param sizeOf - Sizes a repository relative file, undefined when it is not there
 * @returns The artefact, integrity included
 */
export function projectAiDocs(
  request: ProjectionRequest,
  read: FileReader,
  sizeOf: FileSizer,
): AiDocsProjection {
  const build = read(BUILD_FILE);
  const amendments = read(AMENDMENTS_FILE);
  const spec = read(SPEC_FILE);
  const claimMap = read(CLAIM_MAP_FILE);

  const markers: DeferralMarker[] = [];
  for (const file of request.deferralDocuments) {
    const text = read(file);
    if (text === undefined) continue;
    markers.push(...findMarkers(file, text));
  }

  const suiteRows: Record<string, readonly string[] | null> = {};
  for (const row of request.suiteRows) {
    const names = spec === undefined ? null : suiteRowOf(spec, row);
    suiteRows[row] = names === null ? null : names.map(digestOf);
  }

  const milestoneClauses: Record<string, readonly string[] | null> = {};
  for (const milestone of request.milestones) {
    const clauses = spec === undefined ? null : milestoneClausesOf(spec, milestone);
    milestoneClauses[milestone] = clauses === null ? null : clauses.map(digestOf);
  }

  const data: AiDocsProjectionData = {
    documents: request.requiredDocuments.map((file) => ({ file, bytes: sizeOf(file) ?? null })),
    build: build === undefined ? null : projectBuild(build),
    amendments: amendments === undefined ? null : projectAmendments(amendments),
    markers,
    spec: {
      packages: spec === undefined ? null : readSpecPackageLists(spec),
      securityClaims: securityClaimsOf(spec),
      budgetRows: budgetRowsOf(spec),
      suiteRows,
      milestoneClauses,
      readerPages: spec === undefined ? null : readerPagesOf(spec),
    },
    claimMap: claimMap === undefined ? null : claimMapRowsOf(claimMap),
    stylesheets: request.stylesheets.map((file) => {
      const text = read(file);
      return { file, css: text === undefined ? null : projectStylesheet(text) };
    }),
  };

  return { version: PROJECTION_VERSION, data, integrity: integrityOf(data) };
}

/**
 * SPEC 19's promises with their wording replaced by a digest of it.
 *
 * The parser throws where the section is absent, which is correct for a reader that must not
 * report full coverage against nothing. Here it becomes a null the gate reports, because a
 * generator that threw would leave no artefact at all and every gate that reads it would then fail on the
 * artefact rather than on the missing section.
 *
 * @param spec - The specification, undefined when it is not there
 * @returns The claims, or null when the section could not be read
 */
function securityClaimsOf(spec: string | undefined): SpecClaim[] | null {
  if (spec === undefined) return null;

  try {
    return parseSecurityClaims(spec).map((claim) => ({
      id: claim.id,
      text: digestOf(normalizeQuote(claim.text)),
    }));
  } catch {
    return null;
  }
}

/**
 * SPEC 20's rows, by digest of the label and present tense of the threshold.
 *
 * @param spec - The specification, undefined when it is not there
 * @returns The rows, or null when the section could not be read
 */
function budgetRowsOf(
  spec: string | undefined,
): { readonly label: string; readonly threshold: string }[] | null {
  if (spec === undefined) return null;

  try {
    return parseBudgetRows(spec).map((row) => ({
      label: digestOf(row.label),
      threshold: projectThresholdCell(row.threshold),
    }));
  } catch {
    return null;
  }
}

/**
 * The claim map's rows, with the promise cell reduced to figures and the quote to a digest.
 *
 * @param map - The claim map
 * @returns The rows
 */
function claimMapRowsOf(map: string): ClaimMapRow[] {
  return parseClaimMap(map).map((row) => ({
    id: row.id,
    text: projectFigures(row.text),
    proofs: row.proofs,
    status: row.status,
    quoted: row.quoted === '' ? '' : digestOf(row.quoted),
  }));
}

/**
 * A value serialized so that two equal readings serialize identically.
 *
 * Keys sort by code point and arrays keep their order, which is the same canonical form the IR
 * hashes with and for the same reason: a record whose keys arrive in a different order is the same
 * record, and a freshness check that said otherwise would go red on a reordering nobody made.
 *
 * @param value - Anything JSON can hold
 * @returns The canonical text
 */
export function canonicalJson(value: unknown): string {
  // `JSON.stringify(undefined)` answers `undefined` rather than a string, which its own type does
  // not say, and an artefact missing a field would otherwise produce a digest of the word
  // undefined. A missing field is a null here, which is what a reader of the file would see.
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));

  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
}

/**
 * The digest a committed artefact carries of its own contents.
 *
 * A CORRUPTION CHECK AND NOT A TAMPER CHECK, which is worth one sentence here because the file it
 * protects is the whole reason `ai-docs/` can be answered on a clone. There is no secret in it: the
 * digest is this function over the data beside it, so an editor who changes a value and recomputes
 * the field passes every reader. What it catches is the edit made without knowing that, and a write
 * that went wrong.
 *
 * @param data - The projected data
 * @returns The digest
 */
export function integrityOf(data: AiDocsProjectionData): string {
  return digestOf(canonicalJson(data));
}

/**
 * Every gate that reports an error once the committed artefact is deleted.
 *
 * THIS IS THE THIRTEEN, AND IT IS NOT A SKIP COUNT. `lib/skip-accounting.ts` sets out why the three
 * numbers around this change are different quantities; this is the one that is a count of things in
 * the repository, so `projection.spec.ts` derives it from the gate sources and holds this list to
 * it. It is the twelve gates that used to skip, plus `projection-privacy`, the gate the artefact
 * itself needed. Four of the thirteen reach the artefact through `readSpecHalf` rather than calling
 * {@link readProjection} themselves, which is why a grep for one name answers twelve and not
 * thirteen.
 */
export const GATES_THAT_READ_THE_PROJECTION: readonly string[] = [
  'build-manifest',
  'capability-debts',
  'claims',
  'deferrals',
  'events-suites',
  'federation-suites',
  'm6-suites',
  'm7-suites',
  'projection-privacy',
  'publish-list',
  'reader-pages',
  'static-suites',
  'theme-motion',
];

/**
 * Digests turned back into the words they stand for, wherever a committed constant carries them.
 *
 * THIS IS THE WHOLE OF WHAT THE DIGESTS COST AND THE WHOLE OF WHAT PAYS IT BACK. A gate that
 * reconciles a document's list with its own list compares them for equality, which a digest
 * answers exactly. What a digest cannot do is be printed, so an entry the gate's own list already
 * carries is printed from that list, and an entry it does not carry, which is the failure being
 * reported, is printed as the digest with the place to look beside it. Nothing here changes a
 * verdict; it changes which of two messages a reader gets.
 *
 * @param digests - What the artefact recorded, null when the document stated nothing
 * @param known - The words this gate already spells for itself, from its configuration
 * @param where - Where a reader should look for a digest that matches none of them
 * @returns The names, in the artefact's order, or null
 */
export function namesFromDigests(
  digests: readonly string[] | null,
  known: readonly string[],
  where: string,
): string[] | null {
  if (digests === null) return null;

  const byDigest = new Map(known.map((name) => [digestOf(name), name]));

  return digests.map((digest) => byDigest.get(digest) ?? `${digest}, stated in ${where}`);
}

/** What a gate got when it asked for the artefact. */
export type ProjectionRead =
  | {
      readonly ok: true;
      readonly projection: AiDocsProjection;
      /**
       * What the file weighs, so the one bound no position can carry is measured on the file that
       * ships rather than on a re-serialization of what was parsed out of it.
       */
      readonly bytes: number;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * Reads the committed artefact and checks it against its own integrity digest.
 *
 * A MISSING OR UNREADABLE ARTEFACT IS NEVER A SKIP. The whole point of committing it is that
 * {@link GATES_THAT_READ_THE_PROJECTION} have something to read on a clone, so a checkout without
 * it is a checkout where thirteen checks cannot run, which is a defect in the tree and not a
 * property of the machine.
 *
 * @param repoRoot - Absolute repository root
 * @returns The artefact, or why it could not be trusted
 */
export function readProjection(repoRoot: string): ProjectionRead {
  const path = join(repoRoot, PROJECTION_FILE);

  if (!existsSync(path)) {
    return {
      ok: false,
      reason: `${PROJECTION_FILE} is not in this checkout. It is the committed reading of ai-docs/ that this gate runs on, so nothing here could be checked at all. Run ${PROJECTION_COMMAND} on a tree that has ai-docs/ and commit the result`,
    };
  }

  let parsed: unknown;
  let bytes = 0;
  try {
    const text = readFileSync(path, 'utf8');
    bytes = Buffer.byteLength(text);
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    return {
      ok: false,
      reason: `${PROJECTION_FILE} is not readable as JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const projection = parsed as AiDocsProjection;

  if (projection.version !== PROJECTION_VERSION) {
    return {
      ok: false,
      reason: `${PROJECTION_FILE} is version ${String(projection.version)} and this gate reads version ${String(PROJECTION_VERSION)}. An artefact of another shape answering today's questions is the silent pass it exists against; run ${PROJECTION_COMMAND}`,
    };
  }

  const integrity = integrityOf(projection.data);
  if (integrity !== projection.integrity) {
    return {
      ok: false,
      reason: `${PROJECTION_FILE} does not match its own integrity digest: it carries ${projection.integrity} and its contents hash to ${integrity}. The file was edited by hand rather than generated, or a write to it went wrong. This digest detects corruption and not tampering: it is computed from the data beside it with no secret, so an edit that recomputed the field would have passed here. Run ${PROJECTION_COMMAND}`,
    };
  }

  return { ok: true, projection, bytes };
}

/**
 * Regenerates the projection from the documents on this machine.
 *
 * @param repoRoot - Absolute repository root
 * @param request - Which documents and which rows, taken from the gate configuration
 * @returns The artefact as the documents say it should be
 */
export function projectFromDisk(repoRoot: string, request: ProjectionRequest): AiDocsProjection {
  const read: FileReader = (file) => {
    try {
      return readFileSync(join(repoRoot, file), 'utf8');
    } catch {
      return undefined;
    }
  };

  const sizeOf: FileSizer = (file) => {
    try {
      return statSync(join(repoRoot, file)).size;
    } catch {
      return undefined;
    }
  };

  return projectAiDocs(request, read, sizeOf);
}

/**
 * Writes the artefact where the gates look for it.
 *
 * ONE WRITER FOR THE GENERATOR AND FOR THE CASES THAT PLANT A TREE, so a fixture cannot be written
 * in a shape the real file is never in. Two spaces and a trailing newline, which is what prettier
 * produces for JSON and what `format:check` holds the committed file to.
 *
 * @param repoRoot - Absolute root to write into
 * @param projection - What to write
 */
export function writeProjection(repoRoot: string, projection: AiDocsProjection): void {
  const path = join(repoRoot, PROJECTION_FILE);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(projection, null, 2)}\n`, 'utf8');
}

/**
 * Which parts of the artefact no longer say what the documents say.
 *
 * @param committed - The artefact in the repository
 * @param regenerated - What the documents produce today
 * @returns The names of the sections that differ, empty when the artefact is fresh
 */
export function staleSections(
  committed: AiDocsProjectionData,
  regenerated: AiDocsProjectionData,
): string[] {
  const keys = new Set([...Object.keys(committed), ...Object.keys(regenerated)]);
  const stale: string[] = [];

  for (const key of [...keys].sort()) {
    const left = canonicalJson((committed as unknown as Record<string, unknown>)[key]);
    const right = canonicalJson((regenerated as unknown as Record<string, unknown>)[key]);
    if (left !== right) stale.push(key);
  }

  return stale;
}
