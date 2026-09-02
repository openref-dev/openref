/**
 * Integrity of `ai-docs/BUILD.md`.
 *
 * BUILD.md addresses its tasks by absolute line number. A CONTENTS entry says
 * `L0268-L0288`, and a session reads exactly those lines. Nothing in the file itself
 * detects a shift: insert one line near the top and every session after it reads the
 * wrong task, silently, forever.
 *
 * Two things can shift it. A well meant edit, which the PROTOCOL header forbids, and a
 * formatter, which does not read prose. `.prettierignore` covers `ai-docs`, but an ignore
 * file is a configuration that can be edited, so this gate is the check that the ignore
 * file is doing its job.
 *
 * This gate runs first. Every later gate reports on code that was written against a task
 * description, so a wrong task description invalidates the rest of the run.
 */

/** One document the project is written against, and what it is for. */
export interface RequiredDoc {
  readonly file: string;
  readonly purpose: string;
}

/** How a required document was found, or was not. */
export type DocPresence = 'ok' | 'missing' | 'empty';

/** The state of one required document. */
export interface DocCheck {
  readonly file: string;
  readonly purpose: string;
  readonly presence: DocPresence;
  readonly bytes: number;
}

/**
 * Checks that every document the project is written against is present and has content.
 *
 * `ai-docs/` is deliberately outside the repository, which means no check that walks tracked
 * files can see these at all. A missing SPEC.md does not announce itself: a session simply
 * reads the next best thing and improvises, and the divergence is found several tasks later
 * when the code and the specification no longer agree.
 *
 * Emptiness counts as absence. A placeholder file passes a presence check while carrying none
 * of the decisions the next session inherits.
 *
 * @param docs - The documents to look for
 * @param minBytes - Fewest bytes a document can hold and still count as one
 * @param sizeOf - Size of a file in bytes, or `undefined` when it cannot be read
 * @returns One result per document, in the order given
 */
export function checkRequiredDocs(
  docs: readonly RequiredDoc[],
  minBytes: number,
  sizeOf: (file: string) => number | undefined,
): DocCheck[] {
  return docs.map((doc) => {
    const bytes = sizeOf(doc.file);

    if (bytes === undefined) {
      return { file: doc.file, purpose: doc.purpose, presence: 'missing', bytes: 0 };
    }

    return {
      file: doc.file,
      purpose: doc.purpose,
      presence: bytes < minBytes ? 'empty' : 'ok',
      bytes,
    };
  });
}

/** One entry in the CONTENTS block. */
export interface BuildTaskEntry {
  readonly id: string;
  readonly done: boolean;
  readonly startLine: number;
  readonly endLine: number;
  readonly title: string;
}

/** One integrity problem found in BUILD.md. */
export interface BuildManifestIssue {
  readonly rule: string;
  readonly message: string;
}

const CONTENTS_PATTERN = /^- \[([ x])\] `(T\d{3})` +L(\d{4})-L(\d{4}) +(.+?) *$/;
const HEADING_PATTERN = /^### (T\d{3}) \[([ x])\] (.+?) *$/;

/**
 * Splits a file into lines the way `wc -l` counts them.
 *
 * A trailing newline terminates the last line, it does not begin an empty one.
 *
 * @param text - Whole file contents
 * @returns One entry per line, index 0 holding line 1
 */
export function splitLines(text: string): string[] {
  const lines = text.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * Reads every CONTENTS entry from BUILD.md.
 *
 * @param lines - Lines of BUILD.md, index 0 holding line 1
 * @returns Entries in the order they are written
 */
export function parseContents(lines: readonly string[]): BuildTaskEntry[] {
  const entries: BuildTaskEntry[] = [];

  for (const line of lines) {
    const match = CONTENTS_PATTERN.exec(line);
    if (match === null) continue;

    entries.push({
      id: match[2] ?? '',
      done: match[1] === 'x',
      startLine: Number(match[3]),
      endLine: Number(match[4]),
      title: match[5] ?? '',
    });
  }

  return entries;
}

/**
 * A heading in the amendments that declares a task id the plan can hand work to.
 *
 * A retrofit, `T015-R1`, and a task with no number yet, `TX-VIS`, are both real owners.
 * `ai-docs/BUILD.md` cannot gain a task without being regenerated, which is the maintainer's
 * call, so work scheduled between regenerations lives in the amendments and owns things there.
 */
const AMENDMENT_TASK_PATTERN = /^### \[[ x]\] `((?:T\d{3}-R\d*)|(?:TX-[A-Z-]+))`/gm;

/**
 * Every task id the plan carries, from both files that can hold one.
 *
 * ONE DEFINITION RATHER THAN ONE PER GATE, and that is why it moved here on 2026-08-10. The
 * claims gate and the budget exceptions gate each carried a copy, and the copies had drifted:
 * one accepted a retrofit as an owner and the other did not, so `T011-R` could excuse a budget
 * and could not own a claim. Two gates asking the same question of the same two files have to
 * get the same answer, or the disagreement surfaces as work that is owned in one place and
 * unowned in the other.
 *
 * @param build - Text of `ai-docs/BUILD.md`
 * @param amendments - Text of `ai-docs/BUILD-AMENDMENTS.md`, empty when it could not be read
 * @returns Task ids, in no particular order
 */
export function planTaskIds(build: string, amendments: string): string[] {
  const ids = parseContents(splitLines(build)).map((entry) => entry.id);

  for (const match of amendments.matchAll(AMENDMENT_TASK_PATTERN)) {
    ids.push(match[1] ?? '');
  }

  return ids;
}

/**
 * One PER TASK AMENDMENTS section: work or a question addressed to a task of BUILD.md.
 *
 * A retrofit and a task with no number are not these. Their ids are `T002-R1` and `TX-VIS`, they
 * own work of their own rather than adding it to somebody else's task, and the file's protocol
 * says a retrofit stays open while the task it reopens keeps its original tick. The pattern below
 * matches a bare task id and therefore neither of them.
 */
export interface AmendmentSection {
  readonly taskId: string;
  readonly done: boolean;
  readonly title: string;
  /** Line the heading is on, 1 based, so a message can send a reader to it. */
  readonly line: number;
}

const AMENDMENT_SECTION_PATTERN = /^### \[([ x])\] `(T\d{3})`(?: +(.*?))? *$/;

/**
 * Reads every per task amendment section.
 *
 * @param lines - Lines of `ai-docs/BUILD-AMENDMENTS.md`, index 0 holding line 1
 * @returns Sections in file order
 */
export function parseAmendmentSections(lines: readonly string[]): AmendmentSection[] {
  const sections: AmendmentSection[] = [];

  lines.forEach((line, index) => {
    const match = AMENDMENT_SECTION_PATTERN.exec(line);
    if (match === null) return;

    sections.push({
      taskId: match[2] ?? '',
      done: match[1] === 'x',
      title: match[3] ?? '',
      line: index + 1,
    });
  });

  return sections;
}

/**
 * Checks that no task was ticked over work addressed to it, per SPEC 0's ninth class.
 *
 * THE MECHANISM THAT FAILED WAS AN ASSUMPTION NOBODY HAD WRITTEN DOWN: that a task which closes
 * has answered what was filed against it. A question about a NUL byte was filed against `T025`,
 * `T025` ticked, no gate was built, and a third file acquired the same defect. Nothing anywhere
 * connected the two boxes, so the failure was invisible by construction.
 *
 * The shape is the one `BUDGET_EXCEPTIONS` already uses on a milestone: the entry does not move
 * the thing it is about, it keeps the thing it is about from being declared finished. Here the
 * open section keeps the task from being ticked, and the way out is to answer it and tick the
 * section, to untick the task, or, when the work reopens a task that has already closed, to refile
 * it as a retrofit with its own id, which is what this file already calls that.
 *
 * The reverse direction is checked for the reason every list in this repository is checked in
 * both: a section addressed to a task id BUILD.md does not carry is read by nobody, and it is
 * indistinguishable from a section that was never written.
 *
 * @param sections - The per task amendment sections
 * @param tasks - The CONTENTS entries of BUILD.md
 * @returns Every problem found, empty when no task is ticked over an open section
 */
export function checkAmendmentSections(
  sections: readonly AmendmentSection[],
  tasks: readonly BuildTaskEntry[],
): BuildManifestIssue[] {
  const issues: BuildManifestIssue[] = [];
  const byId = new Map(tasks.map((task) => [task.id, task]));

  for (const section of sections) {
    const task = byId.get(section.taskId);

    if (task === undefined) {
      issues.push({
        rule: 'amendment-unknown-task',
        message: `${section.taskId} has an amendment section at L${String(section.line)}, ${describeLine(section.title)}, and BUILD.md carries no such task. A section addressed to nothing is read by nobody`,
      });
      continue;
    }

    if (!task.done || section.done) continue;

    issues.push({
      rule: 'amendment-open-on-closed-task',
      message:
        `${section.taskId} is [x] in BUILD.md and its amendment section at L${String(section.line)} is [ ]: ${describeLine(section.title)}. ` +
        `A task cannot be ticked over work addressed to it. Answer it and tick the section, untick ${section.taskId}, or, if this reopens a task that has already closed, refile it as a retrofit with its own id`,
    });
  }

  return issues;
}

/**
 * One RETROFIT or TASKS NOT YET IN BUILD.md entry: work that owns itself.
 *
 * THESE ARE EXCLUDED FROM {@link checkAmendmentSections} AND THE EXCLUSION IS CORRECT: that
 * check keeps a task of BUILD.md from being ticked over work addressed to it, a retrofit
 * reopens a task that keeps its original tick, and a TX task has no BUILD.md task at all, so
 * there is no tick for either to block. What the exclusion also did, and should not have, was
 * leave them with no expiry of any kind. `TX-SERVED` said owner M1 after M1 closed, `TX-CLOCK`
 * carried two thresholds to a milestone that was over, and `T005-R1` sat open for two days
 * with tasks ticking past it, because the only thing enforcing their schedules was the prose
 * inside them. So an entry declares the milestone it must close inside, on a line of its own,
 * and {@link checkOwnedEntries} holds the declaration to BUILD.md the same way
 * `CAPABILITY_DEBTS` entries are held: the milestone must exist, and it must not be finished
 * while the entry is open.
 */
export interface OwnedEntry {
  readonly id: string;
  readonly done: boolean;
  readonly title: string;
  /** Line the heading is on, 1 based, so a message can send a reader to it. */
  readonly line: number;
  /** Milestone the entry declares it closes inside, or undefined when it declares none. */
  readonly milestone: string | undefined;
}

const OWNED_ENTRY_PATTERN = /^### \[([ x])\] `((?:T\d{3}-R\d*)|(?:TX-[A-Z-]+))`(?: +(.*?))? *$/;
/**
 * The milestone an entry declares it closes inside.
 *
 * `M\d+` OR `RELEASE`, AND THE SECOND HALF WAS MISSING UNTIL `T065`. `MILESTONE_PATTERN` below
 * reads `**RELEASE**` out of the CONTENTS block as a milestone like any other, with `T063`, `T064`
 * and `T065` under it, so `checkOwnedEntries` can expire an entry homed there; this pattern could
 * not read the declaration, so no entry could ever be homed there and release block work had
 * nowhere to live but a per task section. Two regular expressions in one file disagreeing about
 * what a milestone is, with only one of them able to fail: the mechanism was silent about the
 * block by construction, which is exactly the class it exists to prevent one level down.
 */
const MILESTONE_LINE_PATTERN = /^\*\*Milestone:\*\* (M\d+|RELEASE)\b/;

/**
 * Reads every RETROFIT and TX entry, with the milestone line its body declares.
 *
 * A milestone line belongs to the entry whose heading precedes it. One that appears before any
 * entry heading belongs to nothing and is ignored, and only the first line of an entry counts,
 * so a second declaration cannot quietly loosen the first.
 *
 * @param lines - Lines of `ai-docs/BUILD-AMENDMENTS.md`, index 0 holding line 1
 * @returns Entries in file order
 */
export function parseOwnedEntries(lines: readonly string[]): OwnedEntry[] {
  interface Draft {
    id: string;
    done: boolean;
    title: string;
    line: number;
    milestone: string | undefined;
    sealed: boolean;
  }

  const drafts: Draft[] = [];
  let inBody = false;

  lines.forEach((line, index) => {
    const heading = OWNED_ENTRY_PATTERN.exec(line);
    if (heading !== null) {
      drafts.push({
        id: heading[2] ?? '',
        done: heading[1] === 'x',
        title: heading[3] ?? '',
        line: index + 1,
        milestone: undefined,
        sealed: false,
      });
      inBody = true;
      return;
    }

    // Any other heading ends the entry's body, so a milestone line under a PER TASK section
    // or under the next chapter cannot be read as this entry's.
    if (/^#{2,3} /.test(line)) {
      inBody = false;
      return;
    }

    const current = drafts[drafts.length - 1];
    if (!inBody || current === undefined || current.sealed) return;

    const milestone = MILESTONE_LINE_PATTERN.exec(line);
    if (milestone === null) return;

    current.milestone = milestone[1];
    current.sealed = true;
  });

  return drafts.map(({ id, done, title, line, milestone }) => ({
    id,
    done,
    title,
    line,
    milestone,
  }));
}

/**
 * Checks that every open RETROFIT and TX entry closes inside a milestone that is still open.
 *
 * A closed entry is history and is not checked: its milestone has done its work. An open one
 * must name a milestone BUILD.md carries, with at least one unticked task left in it, because
 * an entry whose milestone is finished is a schedule nobody can be held to, which is exactly
 * the state the three stale entries of 2026-08-13 were found in.
 *
 * @param entries - The RETROFIT and TX entries
 * @param milestones - The milestones of BUILD.md with their tasks
 * @returns Every problem found, empty when every open entry has a live expiry
 */
export function checkOwnedEntries(
  entries: readonly OwnedEntry[],
  milestones: readonly BuildMilestone[],
): BuildManifestIssue[] {
  const issues: BuildManifestIssue[] = [];

  for (const entry of entries) {
    if (entry.done) continue;

    if (entry.milestone === undefined) {
      issues.push({
        rule: 'entry-no-milestone',
        message:
          `${entry.id} at L${String(entry.line)} is open and declares no **Milestone:** line, so nothing can expire it. ` +
          `An entry with no expiry is enforced by somebody's memory`,
      });
      continue;
    }

    const milestone = milestones.find((candidate) => candidate.id === entry.milestone);

    if (milestone === undefined) {
      issues.push({
        rule: 'entry-unknown-milestone',
        message: `${entry.id} at L${String(entry.line)} declares ${entry.milestone}, which is not a milestone BUILD.md carries`,
      });
      continue;
    }

    if (milestone.tasks.every((task) => task.done)) {
      issues.push({
        rule: 'entry-milestone-closed',
        message:
          `${entry.id} at L${String(entry.line)} had to close inside ${milestone.label}, and every task of that milestone is ticked while the entry is open: ` +
          `${describeLine(entry.title)}. Do the work, or re-home the entry with a dated note saying why it moved`,
      });
    }
  }

  return issues;
}

/** One milestone heading in the CONTENTS block, with the tasks written under it. */
export interface BuildMilestone {
  readonly id: string;
  readonly label: string;
  readonly tasks: readonly BuildTaskEntry[];
}

const MILESTONE_PATTERN = /^\*\*([A-Z][A-Z0-9]*)(?: - (.+?))?\*\*$/;

/**
 * Groups the CONTENTS entries under the milestone headings above them.
 *
 * A milestone is what an exception expires against: an entry that has to clear by M0 is one
 * that cannot still be there when the last M0 task is ticked. Nothing else in the plan states
 * which tasks belong to which milestone, so it is read from the file rather than duplicated.
 *
 * A heading with no task under it is dropped. The task bodies further down the file hold bold
 * lines of their own, and one of them matching this pattern would otherwise invent a milestone
 * that owns nothing.
 *
 * @param lines - Lines of BUILD.md, index 0 holding line 1
 * @returns Milestones in file order, each with its tasks in file order
 */
export function parseMilestones(lines: readonly string[]): BuildMilestone[] {
  const milestones: { id: string; label: string; tasks: BuildTaskEntry[] }[] = [];

  for (const line of lines) {
    const heading = MILESTONE_PATTERN.exec(line);
    if (heading !== null) {
      const id = heading[1] ?? '';
      milestones.push({
        id,
        label: heading[2] === undefined ? id : `${id} - ${heading[2]}`,
        tasks: [],
      });
      continue;
    }

    const entry = CONTENTS_PATTERN.exec(line);
    if (entry === null) continue;

    const current = milestones[milestones.length - 1];
    if (current === undefined) continue;

    current.tasks.push({
      id: entry[2] ?? '',
      done: entry[1] === 'x',
      startLine: Number(entry[3]),
      endLine: Number(entry[4]),
      title: entry[5] ?? '',
    });
  }

  return milestones.filter((milestone) => milestone.tasks.length > 0);
}

/**
 * Checks BUILD.md against its own addressing contract.
 *
 * @param text - Whole contents of `ai-docs/BUILD.md`
 * @param expectedLineCount - The line count the CONTENTS ranges were written against
 * @param expectedTaskCount - The number of tasks the file is known to contain
 * @returns Every problem found, empty when the file is intact
 */
export function checkBuildManifest(
  text: string,
  expectedLineCount: number,
  expectedTaskCount: number,
): BuildManifestIssue[] {
  const issues: BuildManifestIssue[] = [];
  const lines = splitLines(text);

  if (lines.length !== expectedLineCount) {
    issues.push({
      rule: 'line-count',
      message: `BUILD.md has ${String(lines.length)} lines, expected exactly ${String(expectedLineCount)}. Every CONTENTS range below the edit now points at the wrong task`,
    });
  }

  const entries = parseContents(lines);

  if (entries.length !== expectedTaskCount) {
    issues.push({
      rule: 'task-count',
      message: `CONTENTS lists ${String(entries.length)} tasks, expected ${String(expectedTaskCount)}. A reformatted CONTENTS block stops parsing before it stops looking correct`,
    });
  }

  const seen = new Set<string>();
  let previousEnd = 0;

  for (const entry of entries) {
    if (seen.has(entry.id)) {
      issues.push({ rule: 'duplicate-id', message: `${entry.id} appears twice in CONTENTS` });
    }
    seen.add(entry.id);

    if (entry.startLine <= previousEnd) {
      issues.push({
        rule: 'range-order',
        message: `${entry.id} starts at L${String(entry.startLine)}, at or before the end of the previous task at L${String(previousEnd)}`,
      });
    }
    previousEnd = entry.endLine;

    if (entry.endLine < entry.startLine) {
      issues.push({
        rule: 'range-order',
        message: `${entry.id} ends at L${String(entry.endLine)}, before it starts at L${String(entry.startLine)}`,
      });
    }

    if (entry.endLine > lines.length) {
      issues.push({
        rule: 'range-bounds',
        message: `${entry.id} ends at L${String(entry.endLine)}, past the end of the file at L${String(lines.length)}`,
      });
      continue;
    }

    const headingLine = lines[entry.startLine - 1];
    if (headingLine === undefined) {
      issues.push({
        rule: 'range-bounds',
        message: `${entry.id} starts at L${String(entry.startLine)}, past the end of the file`,
      });
      continue;
    }

    const heading = HEADING_PATTERN.exec(headingLine);
    if (heading === null) {
      issues.push({
        rule: 'heading-missing',
        message: `${entry.id} points at L${String(entry.startLine)}, which is not a task heading: ${describeLine(headingLine)}`,
      });
      continue;
    }

    if (heading[1] !== entry.id) {
      issues.push({
        rule: 'heading-mismatch',
        message: `${entry.id} points at L${String(entry.startLine)}, which is the heading of ${String(heading[1])}`,
      });
      continue;
    }

    if ((heading[2] === 'x') !== entry.done) {
      issues.push({
        rule: 'box-mismatch',
        message: `${entry.id} is [${entry.done ? 'x' : ' '}] in CONTENTS and [${String(heading[2])}] on its heading. Both boxes are ticked together or neither is`,
      });
    }

    if (heading[3] !== entry.title) {
      issues.push({
        rule: 'title-mismatch',
        message: `${entry.id} is titled ${describeLine(entry.title)} in CONTENTS and ${describeLine(heading[3] ?? '')} on its heading`,
      });
    }
  }

  return issues;
}

function describeLine(line: string): string {
  const collapsed = line.replace(/\s+/g, ' ').trim();
  const shown = collapsed.length > 80 ? `${collapsed.slice(0, 77)}...` : collapsed;
  return `"${shown}"`;
}
