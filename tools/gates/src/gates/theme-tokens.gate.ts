import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { THEME_STYLE_ROOTS, THEME_TOKEN_SOURCES } from '../config.js';
import { findCssLiterals, findTokenValueLiterals } from '../lib/css-literals.js';
import { collectFiles } from '../lib/walk.js';
import type { Gate, GateFinding, GateResult } from '../types.js';

/**
 * Fails the build on a hardcoded colour, length or font in the default theme.
 *
 * The core ships no visual opinion, per STANDARDS 11 and BUILD T009. That is only true while
 * every visible value traces to a token, and one literal that escaped is a value an L0 theme
 * cannot reach. The generated token stylesheet is exempt because it is where the values are
 * defined; nothing else is.
 *
 * A literal inside a `var()` fallback counts. It is what ships when the token is not set, and
 * it is the likeliest place for a hardcoded colour to survive unnoticed. The rule and the
 * reasons for choosing it over the conditional alternative are in `lib/css-literals.ts`.
 *
 * The token stylesheet is exempt from that scan and gets its own, per T009-R2. It defines
 * values, so a colour that is a whole value is what it is for; a colour written into a
 * composite value, a gradient or a shadow, is a use, and a use must reference a token. That
 * one is the case a real handover shipped and the first version of this gate could not see.
 */
export const themeTokensGate: Gate = {
  id: 'theme-tokens',
  title: 'Default theme reads only tokens',

  run(context): Promise<GateResult> {
    const findings: GateFinding[] = [];
    let scanned = 0;
    let failed = false;

    for (const root of THEME_STYLE_ROOTS) {
      for (const relativePath of collectFiles(
        join(context.repoRoot, root),
        ['.css'],
        context.repoRoot,
      )) {
        const css = readFileSync(join(context.repoRoot, relativePath), 'utf8');

        if (THEME_TOKEN_SOURCES.includes(relativePath)) {
          scanned += 1;

          for (const literal of findTokenValueLiterals(css)) {
            failed = true;
            findings.push({
              level: 'error',
              message: `${relativePath}:${String(literal.line)} [token-value] ${literal.property}: ${literal.value} - ${literal.reason}`,
            });
          }

          continue;
        }

        scanned += 1;

        for (const literal of findCssLiterals(css)) {
          failed = true;
          findings.push({
            level: 'error',
            message: `${relativePath}:${String(literal.line)} [${literal.kind}] ${literal.property}: ${literal.value} - ${literal.reason}`,
          });
        }
      }
    }

    if (scanned === 0) {
      findings.push({
        level: 'info',
        message: `SKIP no stylesheets under ${THEME_STYLE_ROOTS.join(', ')} (produced by T009)`,
      });

      return Promise.resolve({
        id: themeTokensGate.id,
        title: themeTokensGate.title,
        status: 'skip',
        skipReason: 'artifact-absent',
        findings,
      });
    }

    if (!failed) {
      findings.push({
        level: 'info',
        message: `${String(scanned)} stylesheet(s) read only tokens; ${THEME_TOKEN_SOURCES.join(' and ')} are where values are defined, one per shipped theme, and they compose rather than repeat them`,
      });
    }

    return Promise.resolve({
      id: themeTokensGate.id,
      title: themeTokensGate.title,
      status: failed ? 'fail' : 'pass',
      findings,
    });
  },
};
