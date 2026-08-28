/**
 * Reading the security and budget claims out of the specification, and the map that answers
 * them out of `ai-docs/CLAIM-MAP.md`.
 *
 * THE CLAIM IS THE PRODUCT AND THE PROOF IS THE PRODUCT. SPEC 19 is a list of ten promises
 * about what this reference will not do, and SPEC 20 is a list of numbers it will not exceed.
 * Every one of them is worth exactly as much as the test that would go red if it stopped being
 * true, and a promise with no such test is marketing. T015's definition of done says so in
 * those words: every claim proved by a test that can fail, not by an assertion in a document.
 *
 * SO THE MAP IS CHECKED AGAINST BOTH SIDES RATHER THAN READ. The claims come from `SPEC.md`
 * itself, so a claim added there and not answered here fails; the proofs are file paths, so a
 * renamed or deleted test fails; and a claim that no milestone has reached yet names the task
 * that owns it, so "not yet" is a scheduled commitment rather than a silence. A map maintained
 * by hand against a specification maintained by hand is two documents drifting, which is the
 * shape of every stale allowlist this project has already had to fix.
 *
 * WHAT THIS CANNOT DO, stated rather than implied: it reads that a named file exists, not that
 * the file proves the claim. Nothing static can read that. The defence against a test that
 * asserts nothing is elsewhere and is the same everywhere in this repository, which is that
 * every check is planted and watched to fail before it is trusted.
 */

/** One claim the specification makes. */
export interface SpecClaim {
  /** Stable identifier, `19.4` for a security claim and a budget id for SPEC 20. */
  readonly id: string;
  /** What the specification says, trimmed to one line. */
  readonly text: string;
}

/** One row of the claim map. */
export interface ClaimMapRow {
  readonly id: string;
  /** The bounds cell, kept whole so the stated figure can be compared to the enforced one. */
  readonly text: string;
  /** Repository relative paths said to prove it, empty when the claim is scheduled. */
  readonly proofs: readonly string[];
  /** `proved`, or the id of the task that owns the claim. */
  readonly status: string;
  /**
   * The promise this row answers, quoted from the specification word for word.
   *
   * THE ROW USED TO CARRY ONLY THE ID, AND THE ID IS AN ORDINAL. T035 measured what that costs:
   * SPEC 19 is a numbered list, so `19.3` means "the third item", and rewriting the third item to
   * say the opposite of what it says left this gate green, while reordering the list repointed
   * every id at a different promise with nothing anywhere going red. A row that quotes its promise
   * is a row that cannot do either: the quote is compared to the specification on every run.
   *
   * Empty for a SPEC 20 budget row, whose text is a threshold and is compared as a value.
   */
  readonly quoted: string;
}

/** Something wrong with the map. */
export interface ClaimIssue {
  readonly rule: string;
  readonly message: string;
}

/** Status that means the claim is answered today. */
export const PROVED = 'proved';

/** Cell text standing for "no file, deliberately". */
const NONE = '-';

/**
 * The ten security claims of SPEC 19.
 *
 * Read out of the numbered list under the section heading. The heading is matched on its
 * number rather than on its title, because the title is Russian prose and a translation
 * would break the parse while the section number is structural.
 *
 * @param spec - Full text of `ai-docs/SPEC.md`
 * @returns One claim per numbered item, in document order
 */
export function parseSecurityClaims(spec: string): SpecClaim[] {
  const section = sectionOf(spec, 19);
  const claims: SpecClaim[] = [];

  for (const line of section.split('\n')) {
    const match = /^(\d+)\.\s+(.+)$/.exec(line.trim());
    if (match === null) continue;

    claims.push({ id: `19.${match[1] ?? ''}`, text: (match[2] ?? '').trim() });
  }

  return claims;
}

/** One row of SPEC 20's table: what it is called, and what the threshold cell says. */
export interface BudgetRow {
  readonly label: string;
  readonly threshold: string;
}

/**
 * The budget rows of SPEC 20.
 *
 * Returned with the label the specification writes rather than an id, because the table has
 * no ids: the ids live in `config.ts`, and tying the two together is the caller's job and the
 * point of the check. What is read is how many rows there are and what each one's threshold
 * cell says, so the values can be compared rather than counted, per the T034 amendment.
 *
 * @param spec - Full text of `ai-docs/SPEC.md`
 * @returns One entry per table row, in document order
 */
export function parseBudgetRows(spec: string): BudgetRow[] {
  const section = sectionOf(spec, 20);
  const rows: BudgetRow[] = [];
  let seenSeparator = false;

  for (const line of section.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) {
      // The table ends at the first line that is not a row, and everything after it is prose
      // about the fonts. Reading on would take a pipe in a sentence for a twelfth budget.
      if (seenSeparator && rows.length > 0) break;
      continue;
    }

    if (/^\|[\s:|-]+\|$/.test(trimmed)) {
      seenSeparator = true;
      continue;
    }

    if (!seenSeparator) continue;

    const cells = trimmed.slice(1, -1).split('|');
    rows.push({ label: (cells[0] ?? '').trim(), threshold: (cells[1] ?? '').trim() });
  }

  return rows;
}

/**
 * A threshold as a comparable quantity: a byte count, a duration, a bare count, or the
 * recorded-only marker two rows carry.
 */
export type Threshold =
  | { readonly kind: 'bytes' | 'seconds' | 'count'; readonly value: number }
  | { readonly kind: 'report' };

/** The words a Russian table row uses for "recorded, not gated". */
const REPORT_MARKER = 'порога нет';

/**
 * Reads the present tense threshold out of one SPEC 20 cell.
 *
 * THE LEADING SEGMENT IS THE PRESENT TENSE AND THE REST OF THE CELL IS HISTORY, which is the
 * prose stance the T034 amendment asked this checker to state: a cell reads `<= 61 KB, was 56
 * until ...`, the comparison reads the value before the first comma or parenthesis, and the
 * narrative after it may name any figure it likes, the way the paragraphs under the table do.
 *
 * @param cell - The threshold cell as the table writes it
 * @returns The quantity, or null when the cell states no readable threshold
 */
export function thresholdOfCell(cell: string): Threshold | null {
  if (cell.includes(REPORT_MARKER)) return { kind: 'report' };

  // The unit is matched without a word boundary, deliberately: the boundary class is
  // ASCII only, so a Cyrillic unit after the digits would read as no unit at all and
  // seconds would count as a bare count, which the parse cases caught on the first run.
  const leading = cell.split(/[,(]/, 1)[0] ?? '';
  const match = /(\d[\d\s ,]*)(КБ|МБ|байт|bytes|KB|MB|с|s)?(?=\s|$)/u.exec(leading);
  if (match?.[1] === undefined) return null;

  const value = Number(match[1].replace(/[\s ,]/g, ''));
  if (Number.isNaN(value)) return null;

  const unit = match[2] ?? '';
  if (unit === 'КБ' || unit === 'KB') return { kind: 'bytes', value: value * 1024 };
  if (unit === 'МБ' || unit === 'MB') return { kind: 'bytes', value: value * 1024 * 1024 };
  if (unit === 'байт' || unit === 'bytes') return { kind: 'bytes', value };
  if (unit === 'с' || unit === 's') return { kind: 'seconds', value };
  return { kind: 'count', value };
}

/**
 * Which way round one SPEC 20 cell states its bound.
 *
 * THE OPERATOR WAS PARSED OFF AND DROPPED UNTIL T035. `thresholdOfCell` reads the first number of
 * the leading segment, so `<= 100 KB` and `>= 100 KB` produced the same threshold and the multiset
 * comparison found them equal: the table could invert every bound it states and stay green, while
 * the configuration went on enforcing ceilings. A budget is a ceiling by definition, so a row
 * stating a floor is the table promising the opposite of what the gate enforces.
 *
 * `unstated` IS ALLOWED AND IS NOT A THIRD BOUND. Several rows write a bare figure, and a bare
 * figure in a budget table reads as a ceiling; what is refused is a row that says otherwise in so
 * many words.
 *
 * @param cell - The threshold cell as the table writes it
 * @returns Which direction the cell states, reading only its leading present tense segment
 */
export function boundDirectionOfCell(cell: string): 'at-most' | 'at-least' | 'unstated' {
  const leading = (cell.split(/[,(]/, 1)[0] ?? '').toLowerCase();

  if (/[≥]|>=|не менее|не меньше|минимум|至少/.test(leading)) return 'at-least';
  if (/[≤]|<=|<|не более|не больше|максимум/.test(leading)) return 'at-most';

  return 'unstated';
}

/** A threshold in the words a finding can print. */
export function thresholdWords(threshold: Threshold): string {
  if (threshold.kind === 'report') return 'recorded, not gated';
  if (threshold.kind === 'seconds') return `${String(threshold.value)} s`;
  if (threshold.kind === 'count') return String(threshold.value);

  return threshold.value % 1024 === 0 && threshold.value >= 1024
    ? `${String(threshold.value / 1024)} KB`
    : `${threshold.value.toLocaleString('en-US')} bytes`;
}

/** What the configuration enforces for one budget id. */
export interface ConfigThreshold {
  readonly id: string;
  readonly threshold: Threshold;
}

/**
 * Compares the SPEC 20 table's thresholds to the configuration's, value against value.
 *
 * AS MULTISETS AND NOT BY POSITION, because the table has no ids and its order is its own:
 * matching by position would force the table to mirror an array in a TypeScript file, and a
 * reordering would read as six moved caps. What the comparison then means: every value the
 * configuration enforces is stated by some row, and every value some row states is enforced.
 * A commit that moves a cap moves both files and stays green; a commit that moves one alone
 * is red at once, which is the answer to the amendment's midway question.
 *
 * @param rows - The table, parsed
 * @param config - What the configuration enforces
 * @returns Issues, empty when the two agree value for value
 */
export function compareBudgetValues(
  rows: readonly BudgetRow[],
  config: readonly ConfigThreshold[],
): ClaimIssue[] {
  const issues: ClaimIssue[] = [];

  const keyOf = (threshold: Threshold): string =>
    threshold.kind === 'report' ? 'report' : `${threshold.kind}:${String(threshold.value)}`;

  const enforced = new Map<string, { count: number; ids: string[] }>();
  for (const entry of config) {
    const key = keyOf(entry.threshold);
    const bucket = enforced.get(key) ?? { count: 0, ids: [] };
    bucket.count += 1;
    bucket.ids.push(entry.id);
    enforced.set(key, bucket);
  }

  for (const row of rows) {
    if (boundDirectionOfCell(row.threshold) === 'at-least') {
      issues.push({
        rule: 'budget-bound-inverted',
        message:
          `the SPEC 20 row "${row.label}" states a lower bound, "${row.threshold}", and every ` +
          'budget the gates enforce is a ceiling. The table promises the opposite of what runs',
      });
    }

    const threshold = thresholdOfCell(row.threshold);
    if (threshold === null) {
      issues.push({
        rule: 'budget-value-unreadable',
        message: `the SPEC 20 row "${row.label}" states no threshold this check can read: "${row.threshold}"`,
      });
      continue;
    }

    const bucket = enforced.get(keyOf(threshold));
    if (bucket === undefined || bucket.count === 0) {
      issues.push({
        rule: 'budget-value-stale',
        message:
          `the SPEC 20 row "${row.label}" states ${thresholdWords(threshold)}, which the gate ` +
          `configuration does not enforce for any budget. One of the two moved without the other`,
      });
      continue;
    }

    bucket.count -= 1;
  }

  for (const bucket of enforced.values()) {
    if (bucket.count === 0) continue;

    for (const id of bucket.ids.slice(bucket.ids.length - bucket.count)) {
      const entry = config.find((candidate) => candidate.id === id);
      issues.push({
        rule: 'budget-value-missing',
        message:
          `the configuration enforces ${thresholdWords(entry?.threshold ?? { kind: 'report' })} ` +
          `for ${id} and no SPEC 20 row states that value. One of the two moved without the other`,
      });
    }
  }

  return issues;
}

/**
 * The spellings of one threshold a claim map row may state it in.
 *
 * @param threshold - The enforced quantity
 * @returns Patterns, any one of which counts as the row stating the value
 */
function figurePatterns(threshold: Threshold): RegExp[] {
  if (threshold.kind === 'report') return [];
  if (threshold.kind === 'seconds') {
    return [new RegExp(`(^|[^\\d])${String(threshold.value)}\\s*s\\b`)];
  }
  if (threshold.kind === 'count') {
    // A separator after the digit counts as a boundary only when no digit follows it: `0,`
    // ends a count where `22,300` continues one.
    return [new RegExp(`(^|[^\\d.,])${String(threshold.value)}([^\\d.,]|,(?!\\d)|\\.(?!\\d)|$)`)];
  }

  const patterns = [new RegExp(`(^|[^\\d])${threshold.value.toLocaleString('en-US')}\\s*bytes`)];
  if (threshold.value % 1024 === 0) {
    patterns.push(new RegExp(`(^|[^\\d.])${String(threshold.value / 1024)}\\s*KB`));
    if (threshold.value % (1024 * 1024) === 0) {
      patterns.push(new RegExp(`(^|[^\\d.])${String(threshold.value / (1024 * 1024))}\\s*MB`));
    }
  }
  return patterns;
}

/**
 * Requires each proved budget row of the claim map to state the enforced value.
 *
 * THE MAP DRIFTED FURTHEST AND FOR LONGEST, per the T034 amendment, and it is the file whose
 * whole purpose is that a claim is answered by something that can fail. A row may carry any
 * history it likes; what it must contain somewhere is the current figure in one of its
 * accepted spellings, so a cap that moves without the map moving goes red.
 *
 * @param map - The claim map rows, with their bounds text
 * @param config - What the configuration enforces, by id
 * @returns Issues, empty when every row states its value
 */
export function checkClaimFigures(
  map: readonly ClaimMapRow[],
  config: readonly ConfigThreshold[],
): ClaimIssue[] {
  const issues: ClaimIssue[] = [];

  for (const entry of config) {
    const patterns = figurePatterns(entry.threshold);
    if (patterns.length === 0) continue;

    const rows = map.filter(
      (row) => row.id === entry.id || partIndexOf(row.id, entry.id) !== undefined,
    );
    if (rows.length === 0) continue;

    if (!rows.some((row) => patterns.some((pattern) => pattern.test(row.text)))) {
      issues.push({
        rule: 'claim-figure-stale',
        message:
          `the claim map row for ${entry.id} does not state the enforced threshold, ` +
          `${thresholdWords(entry.threshold)}. The figure it carries is not the one the gate holds`,
      });
    }
  }

  return issues;
}

/**
 * The section of `SPEC.md` under one numbered heading.
 *
 * @param spec - Full text
 * @param number - Section number, as written in the heading
 * @returns Everything between that heading and the next one of the same level
 * @throws Error when the section is absent, because a claim map checked against nothing would
 *   report full coverage
 */
function sectionOf(spec: string, number: number): string {
  const start = new RegExp(`^## ${String(number)}\\. `, 'm').exec(spec);
  if (start === null) {
    throw new Error(
      `ai-docs/SPEC.md has no section ${String(number)}, so the claims it makes cannot be read`,
    );
  }

  const rest = spec.slice(start.index + start[0].length);
  const end = /^## \d+\. /m.exec(rest);

  return end === null ? rest : rest.slice(0, end.index);
}

/**
 * The rows of the claim map.
 *
 * Every table in the file is read, so the two sections are one list here and are separated by
 * their ids, which cannot collide: a security claim is `19.n` and a budget claim is a budget
 * id.
 *
 * @param map - Full text of `ai-docs/CLAIM-MAP.md`
 * @returns One row per table row
 */
export function parseClaimMap(map: string): ClaimMapRow[] {
  const rows: ClaimMapRow[] = [];

  for (const line of map.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) continue;
    if (/^\|[\s:|-]+\|$/.test(trimmed)) continue;

    const cells = trimmed
      .slice(1, -1)
      .split('|')
      .map((cell) => cell.trim());
    if (cells.length < 4) continue;

    const id = stripCode(cells[0] ?? '');
    if (id === '' || id.toLowerCase() === 'claim') continue;

    const proofs = stripCode(cells[2] ?? '');

    rows.push({
      id,
      text: cells[1] ?? '',
      proofs:
        proofs === NONE || proofs === ''
          ? []
          : proofs
              .split(',')
              .map((path) => stripCode(path))
              .filter((path) => path !== ''),
      status: stripCode(cells[3] ?? ''),
      // KEPT WITH ITS BACKTICKS AND ITS EMPHASIS, because the comparison is with the
      // specification's own line and the specification writes both. Only the surrounding space is
      // normalized, since a table cell has to breathe and a line break in the source is not a
      // change to the promise.
      quoted: normalizeQuote(cells[4] ?? ''),
    });
  }

  return rows;
}

/**
 * A promise reduced to what a comparison should be sensitive to.
 *
 * Whitespace runs collapse and the ends are trimmed. Nothing else: a word changed, a negation
 * added, a reference renumbered, all of them survive this and are meant to.
 *
 * @param text - The promise as written in either document
 * @returns The comparable form
 */
export function normalizeQuote(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

/**
 * Requires every SPEC 19 row of the claim map to quote the promise it answers, word for word.
 *
 * WHAT THIS CATCHES THAT THE ID CANNOT. A promise rewritten to say the opposite of what it said,
 * and a list reordered so that every id points at a different promise. Both left the gate green
 * while the map went on reporting full coverage, which T035 filed as the third of four holes: the
 * text was parsed out of the specification on every run and then never compared with anything.
 *
 * A LETTERED PART QUOTES THE WHOLE PROMISE IT IS PART OF. Splitting `19.2` into three rows splits
 * the proof rather than the promise, so all three carry the same quote, and the promise moving
 * fails all three at once, which is the correct blast radius.
 *
 * @param claims - The SPEC 19 claims, parsed from the specification
 * @param map - The claim map rows
 * @returns Issues, empty when every row quotes its promise as the specification writes it
 */
export function checkClaimQuotes(
  claims: readonly SpecClaim[],
  map: readonly ClaimMapRow[],
): ClaimIssue[] {
  const issues: ClaimIssue[] = [];

  for (const claim of claims) {
    const rows = map.filter(
      (row) => row.id === claim.id || partIndexOf(row.id, claim.id) !== undefined,
    );
    const expected = normalizeQuote(claim.text);

    for (const row of rows) {
      if (row.quoted === '') {
        issues.push({
          rule: 'claim-unquoted',
          message:
            `${row.id} answers a SPEC 19 promise and does not quote it. The id is the promise's ` +
            'ordinal in a numbered list, so a row that carries only the id is answering whatever ' +
            `is in that position today: "${expected}"`,
        });
        continue;
      }

      if (row.quoted === expected) continue;

      issues.push({
        rule: 'claim-text-drift',
        message:
          `${row.id} quotes "${row.quoted}" and SPEC 19 item ${claim.id.slice('19.'.length)} now ` +
          `reads "${expected}". Either the promise changed and the proof beside it was not ` +
          're-read, or the list was reordered and this row now answers a different promise',
      });
    }
  }

  return issues;
}

/** Backticks are how a path is written in a table cell and are not part of the path. */
function stripCode(cell: string): string {
  return cell.replace(/`/g, '').trim();
}

/** What the check needs to know about the world outside the two documents. */
export interface ClaimCheckInput {
  readonly securityClaims: readonly SpecClaim[];
  /** Budget ids the gate configuration knows, which is what the SPEC 20 table is tied to. */
  readonly budgetIds: readonly string[];
  /** Rows of the SPEC 20 table, so the specification and the configuration are compared. */
  readonly budgetRows: readonly BudgetRow[];
  readonly map: readonly ClaimMapRow[];
  /** Task ids that exist in `ai-docs/BUILD.md`, so a scheduled claim names a real task. */
  readonly taskIds: readonly string[];
  /** Whether a repository relative path exists. */
  readonly exists: (path: string) => boolean;
}

/**
 * Checks the map against the specification, the configuration and the file system.
 *
 * @param input - Both documents, already parsed, and a way to look at the repository
 * @returns Every issue found, empty when the map answers every claim
 */
export function checkClaimMap(input: ClaimCheckInput): ClaimIssue[] {
  const issues: ClaimIssue[] = [];
  const expected = [...input.securityClaims.map((claim) => claim.id), ...input.budgetIds];
  const answered = new Set<string>();

  if (input.budgetRows.length !== input.budgetIds.length) {
    issues.push({
      rule: 'budget-count',
      message:
        `SPEC 20 lists ${String(input.budgetRows.length)} budget(s) and the gate configuration ` +
        `knows ${String(input.budgetIds.length)}. One of them gained a row the other never ` +
        `heard of: ${input.budgetRows.map((row) => row.label).join(' / ')}`,
    });
  }

  for (const id of expected) {
    const whole = input.map.filter((row) => row.id === id);
    const parts = input.map.filter((row) => partIndexOf(row.id, id) !== undefined);

    for (const row of [...whole, ...parts]) answered.add(row.id);

    if (whole.length > 0 && parts.length > 0) {
      issues.push({
        rule: 'claim-split-and-whole',
        message: `${id} is answered both as a whole and in parts, so what covers it is undecided`,
      });
    }

    if (whole.length === 0 && parts.length === 0) {
      issues.push({
        rule: 'claim-unanswered',
        message: `${id} is claimed by the specification and has no row in the claim map`,
      });
      continue;
    }

    if (whole.length > 1) {
      issues.push({
        rule: 'claim-answered-twice',
        message: `${id} has ${String(whole.length)} rows in the claim map, so which one is the answer is undecided`,
      });
    }

    // A SPLIT CLAIM HAS TO BE COVERED BY ITS PARTS. Splitting is how a claim whose halves are
    // in different milestones stays honest, and it is also how half of one could disappear:
    // parts running a, c would read as full coverage while leaving b unanswered.
    const letters = parts
      .map((row) => partIndexOf(row.id, id) ?? -1)
      .sort((left, right) => left - right);

    for (const [at, index] of letters.entries()) {
      if (index === at) continue;

      issues.push({
        rule: 'claim-part-missing',
        message: `${id} is split into ${String(parts.length)} parts and they do not run from a without a gap: ${parts.map((row) => row.id).join(', ')}`,
      });
      break;
    }

    for (const row of [...whole, ...parts]) checkRow(row, input, issues);
  }

  for (const row of input.map) {
    if (answered.has(row.id)) continue;

    issues.push({
      rule: 'claim-unknown',
      message: `the claim map answers ${row.id}, which is neither a SPEC 19 claim nor a budget id. A row for a claim nobody makes is a check that cannot fail`,
    });
  }

  return issues;
}

/**
 * Whether a row id is a lettered part of a claim, and which one.
 *
 * @param rowId - Id as the map writes it
 * @param claimId - Id the specification writes
 * @returns 0 for `a`, 1 for `b`, and undefined when the row is not a part of that claim
 */
function partIndexOf(rowId: string, claimId: string): number | undefined {
  if (!rowId.startsWith(claimId) || rowId.length !== claimId.length + 1) return undefined;

  const letter = rowId.slice(claimId.length);
  if (!/^[a-z]$/.test(letter)) return undefined;

  return letter.charCodeAt(0) - 'a'.charCodeAt(0);
}

/**
 * Checks one row.
 *
 * @param row - The row
 * @param input - Everything the check knows
 * @param issues - Where findings go
 */
function checkRow(row: ClaimMapRow, input: ClaimCheckInput, issues: ClaimIssue[]): void {
  if (row.status === PROVED) {
    if (row.proofs.length === 0) {
      issues.push({
        rule: 'proved-without-proof',
        message: `${row.id} is recorded as proved and names no file. That is the assertion in a document T015 exists to replace`,
      });
      return;
    }

    for (const proof of row.proofs) {
      if (input.exists(proof)) continue;

      issues.push({
        rule: 'proof-missing',
        message: `${row.id} is proved by ${proof}, which is not in the repository. A renamed test leaves the claim unproved and the map saying otherwise`,
      });
    }

    return;
  }

  if (!input.taskIds.includes(row.status)) {
    issues.push({
      rule: 'owner-unknown',
      message: `${row.id} is neither proved nor owned by a task in BUILD.md; it says "${row.status}". A claim owned by nobody is a claim nobody will come back to`,
    });
    return;
  }

  if (row.proofs.length > 0) {
    issues.push({
      rule: 'scheduled-with-proof',
      message: `${row.id} is scheduled for ${row.status} and names ${row.proofs.join(', ')} as proof. If a test proves it, the row says proved; if it does not, the file does not belong here`,
    });
  }
}
