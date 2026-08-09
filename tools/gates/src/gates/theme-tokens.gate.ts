import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { THEME_STYLE_ROOTS, THEME_TOKEN_SOURCE } from '../config.js';
import { findCssLiterals } from '../lib/css-literals.js';
import { collectFiles } from '../lib/walk.js';
import type { Gate, GateFinding, GateResult } from '../types.js';

/**
 * Fails the build on a hardcoded colour, length or font in the default theme.
 *
 * The core ships no visual opinion, per STANDARDS 11 and BUILD T009. That is only true while
 * every visible value traces to a token, and one literal that escaped is a value an L0 theme
 * cannot reach. The generated token stylesheet is exempt because it is where the values are
 * defined; nothing else is.
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
        if (relativePath === THEME_TOKEN_SOURCE) continue;

        scanned += 1;
        const literals = findCssLiterals(
          readFileSync(join(context.repoRoot, relativePath), 'utf8'),
        );

        for (const literal of literals) {
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
        findings,
      });
    }

    if (!failed) {
      findings.push({
        level: 'info',
        message: `${String(scanned)} stylesheet(s) read only tokens; ${THEME_TOKEN_SOURCE} is the one place values are defined`,
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
