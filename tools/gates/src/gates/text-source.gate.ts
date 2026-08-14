import { TEXT_SOURCE_EXTENSIONS, TEXT_SOURCE_MIN_FILES, TEXT_SOURCE_ROOTS } from '../config.js';
import { REASON_REMEDY, scanSourceText } from '../lib/text-source.js';
import type { Gate, GateFinding, GateResult } from '../types.js';

/**
 * Fails when a source file under `packages` or `tools` is one a text tool will not read.
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
 * THE COUNT OF FILES SCANNED IS PART OF THE ASSERTION. A scan that walked nothing produces the
 * same empty list of faults as a clean tree, so the figure is printed on every run and a figure
 * below `TEXT_SOURCE_MIN_FILES` fails, per the absence rule of SPEC 0: a proof that nothing is
 * wrong passes trivially when nothing was looked at.
 */
export const textSourceGate: Gate = {
  id: 'text-source',
  title: 'Every source file reads as text',

  run(context): Promise<GateResult> {
    const findings: GateFinding[] = [];
    const scan = scanSourceText(context.repoRoot, TEXT_SOURCE_ROOTS, TEXT_SOURCE_EXTENSIONS);

    for (const file of scan.unreadable) {
      findings.push({
        level: 'error',
        message:
          `${file.path} is not readable as text: ${file.reason} at byte ${String(file.offset)}, ` +
          `line ${String(file.line)} column ${String(file.column)}. ` +
          REASON_REMEDY[file.reason],
      });
    }

    if (scan.scanned < TEXT_SOURCE_MIN_FILES) {
      findings.push({
        level: 'error',
        message:
          `only ${String(scan.scanned)} file(s) were read under ${TEXT_SOURCE_ROOTS.join(', ')}, ` +
          `below the floor of ${String(TEXT_SOURCE_MIN_FILES)}, so this run checked nothing worth ` +
          'reporting on rather than finding nothing wrong',
      });
    }

    if (findings.length === 0) {
      findings.push({
        level: 'info',
        message:
          `${String(scan.scanned)} source file(s) under ${TEXT_SOURCE_ROOTS.join(', ')} read as ` +
          'text, so a search over them reaches every one',
      });
    }

    return Promise.resolve({
      id: textSourceGate.id,
      title: textSourceGate.title,
      status: findings.some((finding) => finding.level === 'error') ? 'fail' : 'pass',
      findings,
    });
  },
};
