import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import {
  rewriteSource,
  type RefusedEdit,
} from '../../infrastructure/adapters/typescript-source.adapter';
import type { FixPlan, PlannedEdit, SkippedFinding } from '../../domain/fix-plan';

/**
 * The half of `doctor --fix` that touches a disk, kept to this file and to nothing else.
 *
 * THE WRITE IS ONE BOOLEAN AT THE END, which is what makes `--dry-run` a preview rather than a
 * second implementation. Everything before it, the reading, the parsing, the refusals and the new
 * text of every file, happens identically in both modes, so the two cannot drift apart without a
 * test noticing: SPEC 7.4 asks for the same edits in the same order with the same provenance, and
 * they are literally the same computation.
 *
 * ONLY `.ts` FILES INSIDE THE REPOSITORY ROOT ARE EVER OPENED. A finding names a repository
 * relative path, and a path that escapes the root, or that is not TypeScript, is refused rather
 * than followed. SPEC 7.4's rule that `--fix` never writes the specification is not a promise
 * about intent here: the only path this service ever resolves is the one the source collector
 * recorded for a handler, and a generated document is not one.
 */

/** One file the run rewrote, with both texts, so a caller can diff or write it. */
export interface RewrittenFile {
  /** Repository relative, exactly as the finding named it. */
  readonly file: string;
  readonly before: string;
  readonly after: string;
}

/** What a whole `--fix` or `--dry-run` pass decided and, when writing, did. */
export interface FixRun {
  readonly applied: readonly PlannedEdit[];
  readonly left: readonly SkippedFinding[];
  readonly files: readonly RewrittenFile[];
  /** True when the new text reached the disk. False for `--dry-run`. */
  readonly written: boolean;
}

/** Where the run may write and whether it may write at all. */
export interface FixOptions {
  /** Absolute repository root that every repository relative path resolves against. */
  readonly root: string;
  /** False for `--dry-run`: everything is computed and nothing is saved. */
  readonly write: boolean;
}

/**
 * Applies a plan to source, or works out what applying it would do.
 *
 * @param plan - What the pure planner decided from the report
 * @param options - The repository root, and whether to write
 * @returns Every applied edit, every finding left alone, and the new text of every file touched
 */
export async function applyFixes(plan: FixPlan, options: FixOptions): Promise<FixRun> {
  const byFile = groupByFile(plan.edits);

  const applied: PlannedEdit[] = [];
  const refused: RefusedEdit[] = [];
  const files: RewrittenFile[] = [];

  for (const [file, edits] of byFile) {
    const absolute = insideRoot(options.root, file);
    if (absolute === undefined) {
      for (const edit of edits) {
        refused.push({
          edit,
          reason: 'no-source-location',
          detail: `${file} is not a TypeScript file inside the repository, so this run will not open it`,
        });
      }
      continue;
    }

    const before = await readSource(absolute);
    if (before === undefined) {
      for (const edit of edits) {
        refused.push({
          edit,
          reason: 'no-source-location',
          detail: `${file} is named by the finding and is not in this repository, so there is nothing to rewrite`,
        });
      }
      continue;
    }

    const rewrite = rewriteSource(file, before, edits);
    applied.push(...rewrite.applied);
    refused.push(...rewrite.refused);
    if (rewrite.applied.length > 0) files.push({ file, before, after: rewrite.text });
  }

  if (options.write) {
    for (const file of files) {
      await writeFile(insideRoot(options.root, file.file) ?? file.file, file.after, 'utf8');
    }
  }

  return {
    applied,
    left: [...plan.skipped, ...refused.map(asSkipped)],
    files,
    written: options.write,
  };
}

/** A refusal from the rewriter, in the shape the summary prints beside the planner's own. */
function asSkipped(refusal: RefusedEdit): SkippedFinding {
  return {
    rule: refusal.edit.rule,
    code: refusal.edit.code,
    subject: refusal.edit.subject,
    reason: refusal.reason,
    detail: refusal.detail,
  };
}

/**
 * Groups edits by the file they touch, keeping report order inside each group and between groups.
 *
 * @param edits - Every planned edit, in report order
 * @returns One entry per file, first appearance first
 */
function groupByFile(edits: readonly PlannedEdit[]): ReadonlyMap<string, readonly PlannedEdit[]> {
  const byFile = new Map<string, PlannedEdit[]>();

  for (const edit of edits) {
    const group = byFile.get(edit.file);
    if (group === undefined) byFile.set(edit.file, [edit]);
    else group.push(edit);
  }

  return byFile;
}

/**
 * The absolute path of a repository relative TypeScript file, or undefined when it is neither.
 *
 * THE ESCAPE CHECK IS ON THE RESOLVED PATH AND NOT ON THE TEXT. A finding's path arrives from a
 * document built somewhere else, so it is input, and `../../etc/passwd` resolves to a real place
 * outside the tree the person agreed to have rewritten.
 *
 * @param root - Absolute repository root
 * @param file - The path a finding named
 * @returns The absolute path, or undefined when it escapes the root or is not TypeScript
 */
function insideRoot(root: string, file: string): string | undefined {
  if (!file.endsWith('.ts') || isAbsolute(file)) return undefined;

  const absolute = resolve(root, file);
  const inside = relative(root, absolute);
  if (inside === '' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) return undefined;

  return absolute;
}

/** A file's text, or undefined when it is not there. */
async function readSource(absolute: string): Promise<string | undefined> {
  try {
    return await readFile(absolute, 'utf8');
  } catch {
    return undefined;
  }
}
