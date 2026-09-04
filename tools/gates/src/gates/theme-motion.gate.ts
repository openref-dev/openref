import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { THEME_TOKEN_STYLESHEETS } from '../config.js';
import { AI_DOCS_DIR } from '../lib/ai-docs.js';
import { auditMotionTokens, MOTION_TOKENS, type StyleSource } from '../lib/motion-tokens.js';
import { PROJECTION_FILE, readProjection } from '../lib/projection.js';
import type { Gate, GateFinding, GateResult } from '../types.js';

/**
 * Holds every theme to the motion half of the design contract.
 *
 * The four motion tokens are core, so all three reference themes declare them, and reduced
 * motion is answered once in the token layer rather than once per theme. That decision is what
 * this gate exists to keep true: with durations as tokens a theme collapses motion by pointing
 * them at the zero token and this can read whether it did; without them each theme writes its
 * own media block and nothing can tell a theme that forgot from a theme with nothing to reduce.
 *
 * IT READS THE DESIGN STYLESHEETS AS WELL AS THE SHIPPED ONE. Only vernier is code today, and
 * a check that saw only the shipped theme would report conformance for one third of the
 * problem.
 *
 * THE THREE THAT LIVE UNDER `ai-docs/` ARRIVE THROUGH THE COMMITTED PROJECTION, since the
 * artefact. Each is reduced to what this check reads and nothing else: every block that declares
 * a custom property, every property name, and the value of the four motion tokens and whatever
 * they alias through. The cascade, the specificity, the load order and the reduced motion query
 * all survive that; the design does not travel with them. It used to skip on every clone, which
 * meant the motion contract was enforced on one machine.
 *
 * A configured stylesheet that is missing is an error, not a skip, whether it is missing from the
 * tree or from the artefact. A theme this cannot read is a theme nothing checks.
 */
export const themeMotionGate: Gate = {
  id: 'theme-motion',
  title: 'Motion is a token in every theme',

  run(context): Promise<GateResult> {
    const findings: GateFinding[] = [];
    let failed = false;

    const read = readProjection(context.repoRoot);

    if (!read.ok) {
      return Promise.resolve({
        id: themeMotionGate.id,
        title: themeMotionGate.title,
        status: 'fail',
        findings: [{ level: 'error', message: `[projection-unreadable] ${read.reason}` }],
      });
    }

    const projected = new Map(
      read.projection.data.stylesheets.map((sheet) => [sheet.file, sheet.css]),
    );

    for (const stylesheet of THEME_TOKEN_STYLESHEETS) {
      const sources: StyleSource[] = [];
      let readable = true;

      for (const file of stylesheet.files) {
        if (file.startsWith(`${AI_DOCS_DIR}/`)) {
          const css = projected.get(file);

          if (css === undefined || css === null) {
            failed = true;
            readable = false;
            findings.push({
              level: 'error',
              message:
                `${stylesheet.theme}: ${file} carries no reading in ${PROJECTION_FILE}, so this ` +
                `theme is unchecked. Either the stylesheet is gone or the artefact predates it`,
            });
            continue;
          }

          sources.push({ file, css });
          continue;
        }

        const path = join(context.repoRoot, file);

        if (!existsSync(path)) {
          failed = true;
          readable = false;
          findings.push({
            level: 'error',
            message: `${stylesheet.theme}: ${file} is not there, so this theme is unchecked`,
          });
          continue;
        }

        sources.push({ file, css: readFileSync(path, 'utf8') });
      }

      if (!readable) continue;

      for (const finding of auditMotionTokens(stylesheet.theme, sources)) {
        failed = true;
        findings.push({ level: finding.level, message: `[${finding.theme}] ${finding.reason}` });
      }
    }

    if (!failed) {
      findings.push({
        level: 'info',
        message: `${String(THEME_TOKEN_STYLESHEETS.length)} theme(s) declare ${String(MOTION_TOKENS.length)} motion tokens in every block, and every duration wins its way to zero under prefers-reduced-motion with the theme's stylesheets in load order`,
      });
    }

    return Promise.resolve({
      id: themeMotionGate.id,
      title: themeMotionGate.title,
      status: failed ? 'fail' : 'pass',
      findings,
    });
  },
};
