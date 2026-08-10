import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { FONT_STYLESHEETS } from '../config.js';
import { auditFontCoverage, readFontFaces } from '../lib/font-coverage.js';
import type { Gate, GateFinding, GateResult } from '../types.js';

/**
 * Holds every `unicode-range` to the bytes of the file it names.
 *
 * A declared range that is narrower than the subset is a quiet failure: the glyph is in the
 * file, the reader sees a system fallback, and nothing anywhere reports it. It happened once,
 * on six code points in five faces, and was found only because a session reproduced a committed
 * font byte for byte. The ranges were rewritten by hand afterwards, which is the same practice
 * that produced the defect, so this reads the `cmap` instead of trusting the stylesheet.
 *
 * A configured stylesheet that is missing is an error, not a skip, for the reason the motion
 * gate gives: a theme this cannot read is a theme nothing checks.
 */
export const themeFontsGate: Gate = {
  id: 'theme-fonts',
  title: 'Every unicode-range matches the subset it declares',

  run(context): Promise<GateResult> {
    const findings: GateFinding[] = [];
    let failed = false;
    let faces = 0;

    for (const stylesheet of FONT_STYLESHEETS) {
      const path = join(context.repoRoot, stylesheet.file);

      if (!existsSync(path)) {
        failed = true;
        findings.push({
          level: 'error',
          message: `${stylesheet.theme}: ${stylesheet.file} is not there, so its faces are unchecked`,
        });
        continue;
      }

      const directory = dirname(path);
      const declarations = readFontFaces(readFileSync(path, 'utf8'));

      if (declarations.length === 0) {
        failed = true;
        findings.push({
          level: 'error',
          message: `${stylesheet.theme}: ${stylesheet.file} declares no @font-face with a src, so nothing was checked`,
        });
        continue;
      }

      const files = new Map<string, Uint8Array>();
      for (const declaration of declarations) {
        const fontPath = join(directory, declaration.file);
        if (existsSync(fontPath)) files.set(declaration.file, readFileSync(fontPath));
      }

      faces += declarations.length;

      for (const finding of auditFontCoverage({ declarations, files })) {
        failed = true;
        findings.push({
          level: finding.level,
          message: `[${stylesheet.theme}] ${finding.file}: ${finding.reason}`,
        });
      }
    }

    if (!failed) {
      findings.push({
        level: 'info',
        message: `${String(faces)} face(s) over ${String(FONT_STYLESHEETS.length)} stylesheet(s) declare a unicode-range covering every code point their cmap maps`,
      });
    }

    return Promise.resolve({
      id: themeFontsGate.id,
      title: themeFontsGate.title,
      status: failed ? 'fail' : 'pass',
      findings,
    });
  },
};
