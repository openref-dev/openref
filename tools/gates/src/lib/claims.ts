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
  /** Repository relative paths said to prove it, empty when the claim is scheduled. */
  readonly proofs: readonly string[];
  /** `proved`, or the id of the task that owns the claim. */
  readonly status: string;
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

/**
 * The budget rows of SPEC 20.
 *
 * Returned with the label the specification writes rather than an id, because the table has
 * no ids: the ids live in `config.ts`, and tying the two together is the caller's job and the
 * point of the check. What is read here is how many rows there are and what each one says.
 *
 * @param spec - Full text of `ai-docs/SPEC.md`
 * @returns One entry per table row, in document order
 */
export function parseBudgetRows(spec: string): string[] {
  const section = sectionOf(spec, 20);
  const rows: string[] = [];
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
    rows.push((cells[0] ?? '').trim());
  }

  return rows;
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
      proofs:
        proofs === NONE || proofs === ''
          ? []
          : proofs
              .split(',')
              .map((path) => stripCode(path))
              .filter((path) => path !== ''),
      status: stripCode(cells[3] ?? ''),
    });
  }

  return rows;
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
  readonly budgetRows: readonly string[];
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
        `heard of: ${input.budgetRows.join(' / ')}`,
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
