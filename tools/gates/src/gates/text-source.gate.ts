import {
  TEXT_SOURCE_EXPECTED_TREES,
  TEXT_SOURCE_EXTENSIONS,
  TEXT_SOURCE_MIN_FILES,
} from '../config.js';
import { BIDI_REMEDY, REASON_REMEDY, scanSourceText } from '../lib/text-source.js';
import type { Gate, GateFinding, GateResult } from '../types.js';

/**
 * Fails when a source file is one a text tool will not read, or one it will read wrongly.
 *
 * WHY IT IS A GATE AND NOT A NOTE. A file with a NUL byte in it compiles, bundles, ships and
 * passes its tests, and is invisible to every search anyone runs over the repository afterwards.
 * Nothing else here would ever notice, which is exactly why it lasted five tasks in
 * `packages/render/src/components/TryItPanel.ts`: 1,305 lines that `grep` skipped in silence while
 * this project ran four separate sweeps that depend on `grep` telling the truth.
 *
 * IT IS THE SIXTH DEFECT CLASS OF SPEC 0 WITH THE TERMS REVERSED. There the check could not reach
 * its material, because the scan excluded it. Here the material refuses the tool: the scan names
 * the file, the file is present, the tool reads it and reports nothing. A sweep that returns zero
 * hits looks the same either way, and that is the whole difficulty.
 *
 * THE SECOND QUESTION, SINCE T042, IS THE ONE SPEC 19.1 ALREADY ASKS OF A RENDERED DOCUMENT. A
 * bidirectional control is well formed UTF-8, so every check this file used to run passed it, and
 * what it does is reorder what a reader sees with no markup at all. In a description the renderer
 * answers it with `unicode-bidi: isolate`; in a source file nothing answered it, and a source file
 * is where a reviewer decides whether the code says what it appears to say.
 *
 * THE COUNT OF FILES SCANNED IS PART OF THE ASSERTION. A scan that walked nothing produces the
 * same empty list of faults as a clean tree, so the figure is printed on every run and a figure
 * below `TEXT_SOURCE_MIN_FILES` fails, per the absence rule of SPEC 0: a proof that nothing is
 * wrong passes trivially when nothing was looked at. The per tree counts are printed with it and
 * every tree of `TEXT_SOURCE_EXPECTED_TREES` must yield a file, because a total cannot see a small
 * tree leaving the scan and a small tree is where the last hole was.
 */
export const textSourceGate: Gate = {
  id: 'text-source',
  title: 'Every source file reads as text, and reads as what it says',

  run(context): Promise<GateResult> {
    const findings: GateFinding[] = [];
    const scan = scanSourceText(context.repoRoot, TEXT_SOURCE_EXTENSIONS);

    for (const file of scan.unreadable) {
      findings.push({
        level: 'error',
        message:
          `${file.path} is not readable as text: ${file.reason} at byte ${String(file.offset)}, ` +
          `line ${String(file.line)} column ${String(file.column)}. ` +
          REASON_REMEDY[file.reason],
      });
    }

    for (const file of scan.bidi) {
      const more =
        file.occurrences === 1 ? '' : `, and ${String(file.occurrences - 1)} more in this file`;
      findings.push({
        level: 'error',
        message:
          `${file.path} carries U+${file.codePoint.toString(16).toUpperCase().padStart(4, '0')} ` +
          `${file.name} at byte ${String(file.offset)}, line ${String(file.line)} column ` +
          `${String(file.column)}${more}. ${BIDI_REMEDY}`,
      });
    }

    // The reading itself, printed before any verdict about it: a reader has to be able to see
    // which tree shrank, and a total cannot say that.
    findings.push({
      level: 'info',
      message: `read ${String(scan.scanned)} file(s): ${scan.trees
        .map((tree) => `${tree.tree} ${String(tree.scanned)}`)
        .join(', ')}`,
    });

    const reached = new Set(scan.trees.map((tree) => tree.tree));
    for (const tree of TEXT_SOURCE_EXPECTED_TREES) {
      if (reached.has(tree)) continue;

      findings.push({
        level: 'error',
        message:
          `${tree} yielded no file this scan reads, so a tree a reader can run is checked by ` +
          'nothing here. Either it left the repository, in which case it leaves this list in the ' +
          'same commit, or the walk stopped reaching it',
      });
    }

    if (scan.scanned < TEXT_SOURCE_MIN_FILES) {
      findings.push({
        level: 'error',
        message:
          `only ${String(scan.scanned)} file(s) were read, below the floor of ` +
          `${String(TEXT_SOURCE_MIN_FILES)}, so this run checked nothing worth reporting on ` +
          'rather than finding nothing wrong',
      });
    }

    const failed = findings.some((finding) => finding.level === 'error');

    if (!failed) {
      findings.push({
        level: 'info',
        message:
          `${String(scan.scanned)} source file(s) read as text and carry no bidirectional ` +
          'control, so a search over them reaches every one and a reviewer reads them in the ' +
          'order they are written',
      });
    }

    return Promise.resolve({
      id: textSourceGate.id,
      title: textSourceGate.title,
      status: failed ? 'fail' : 'pass',
      findings,
    });
  },
};
