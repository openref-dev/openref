import type { CommandDefinition } from '../../domain/command.types';
import {
  BUILD_USAGE,
  DIFF_USAGE,
  DOCTOR_USAGE,
  LINT_USAGE,
  PR_USAGE,
  PREVIEW_USAGE,
} from '../help';
import { runBuild } from './build.command';
import { runDiff } from './diff.command';
import { runDoctor } from './doctor.command';
import { runLint } from './lint.command';
import { runPr } from './pr.command';
import { runPreview } from './preview.command';

const DEFINITIONS: readonly CommandDefinition[] = [
  { name: 'build', usage: BUILD_USAGE, run: runBuild },
  { name: 'preview', usage: PREVIEW_USAGE, run: runPreview },
  { name: 'doctor', usage: DOCTOR_USAGE, run: runDoctor },
  { name: 'lint', usage: LINT_USAGE, run: runLint },
  { name: 'diff', usage: DIFF_USAGE, run: runDiff },
  { name: 'pr', usage: PR_USAGE, run: runPr },
];

/** Every command, keyed by name. */
export const COMMANDS: ReadonlyMap<string, CommandDefinition> = new Map(
  DEFINITIONS.map((definition) => [definition.name, definition]),
);
