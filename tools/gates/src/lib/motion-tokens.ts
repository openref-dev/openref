/**
 * The motion half of the theme contract, per `ai-docs/design/CONTRACT.md`.
 *
 * WHY THIS IS A GATE AND NOT A TEST IN ONE PACKAGE. Only one of the three reference themes is
 * code today; the other two are stylesheets in `ai-docs/design/`. The failure this exists to
 * catch is three themes disagreeing about reduced motion, which no test inside a single package
 * can see. It is also a failure nobody notices by looking: the reader it hurts is the one with
 * a vestibular disorder, and everything renders correctly for everyone else.
 *
 * THE RULE. Every theme declares the four motion tokens in every block where it declares
 * tokens, and carries a `prefers-reduced-motion: reduce` block in which every duration token
 * resolves to zero. The easing curve is exempt: it is a curve, and a transition of zero
 * duration has none to run.
 *
 * RESOLUTION, NOT EQUALITY. A theme may write `0s` or point the duration at the zero token, and
 * the zero token may itself be an alias. What is checked is where the chain ends, because that
 * is what a browser computes and what a reader gets.
 */

/** The four names the contract fixes for the motion group. */
export const MOTION_TOKENS: readonly string[] = [
  '--oref-motion-fast',
  '--oref-motion-normal',
  '--oref-motion-none',
  '--oref-motion-ease',
];

/**
 * The motion tokens that carry a duration.
 *
 * Listed rather than derived from the value, because a theme that wrote a curve into a duration
 * token would then be checked as though it had no duration at all.
 */
export const MOTION_DURATIONS: readonly string[] = [
  '--oref-motion-fast',
  '--oref-motion-normal',
  '--oref-motion-none',
];

/** A duration of zero, whichever unit it is written in. */
const ZERO_DURATION = /^0(?:s|ms)?$/i;

/** A duration, so a curve written into a duration token is caught rather than resolved. */
const DURATION = /^-?(?:\d+\.?\d*|\.\d+)(?:s|ms)$/i;

/** A whole value that is one `var()` reference, with or without a fallback. */
const VAR_REFERENCE = /^var\(\s*(--[\w-]+)\s*(?:,([\s\S]*))?\)$/;

/** A problem found in one theme's token stylesheet. */
export interface MotionFinding {
  readonly level: 'error';
  /** The theme label, for the message. */
  readonly theme: string;
  readonly reason: string;
}

/** One rule block of a stylesheet, with the at-rules it sits inside. */
export interface CssBlock {
  /** The at-rules and the selector, outermost first, joined with a space. */
  readonly prelude: string;
  readonly declarations: ReadonlyMap<string, string>;
}

/** Strips comments so a token name inside prose is never read as a declaration. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/**
 * Reads every rule block with its at-rule chain and its custom property declarations.
 *
 * Written here rather than reused from `css-literals.ts`, which numbers blocks without keeping
 * what they sit inside. Whether a declaration is inside `prefers-reduced-motion` is the entire
 * question this file asks, so the chain has to survive parsing.
 *
 * @param css - Stylesheet text
 * @returns One entry per block that declares at least one custom property
 *
 * @example
 * readBlocks('@media print { :root { --a: 1px; } }');
 * // [{ prelude: '@media print :root', declarations: Map { '--a' => '1px' } }]
 */
export function readBlocks(css: string): CssBlock[] {
  const text = stripComments(css);
  const blocks: { prelude: string; declarations: Map<string, string> }[] = [];
  const stack: string[] = [];
  let pending = '';
  let at = 0;

  while (at < text.length) {
    const character = text[at] ?? '';

    if (character === '{') {
      stack.push(pending.replace(/\s+/g, ' ').trim());
      pending = '';
      at += 1;
      continue;
    }

    if (character === '}') {
      stack.pop();
      pending = '';
      at += 1;
      continue;
    }

    if (character === ';') {
      pending = '';
      at += 1;
      continue;
    }

    if (character === '-' && text.startsWith('--', at)) {
      const colon = text.indexOf(':', at);
      const property = colon === -1 ? '' : text.slice(at, colon).trim();

      if (colon !== -1 && /^--[\w-]+$/.test(property)) {
        let end = colon + 1;
        let depth = 0;

        while (end < text.length) {
          const inner = text[end] ?? '';
          if (inner === '(') depth += 1;
          else if (inner === ')') depth -= 1;
          else if ((inner === ';' || inner === '}') && depth === 0) break;
          end += 1;
        }

        const value = text
          .slice(colon + 1, end)
          .replace(/\s+/g, ' ')
          .trim();
        const prelude = stack.join(' ');
        const existing = blocks.find((block) => block.prelude === prelude);

        if (existing === undefined) {
          blocks.push({ prelude, declarations: new Map([[property, value]]) });
        } else {
          existing.declarations.set(property, value);
        }

        pending = '';
        at = end;
        continue;
      }
    }

    pending += character;
    at += 1;
  }

  return blocks;
}

/** True when a block sits inside a reduced motion media query. */
function isReduced(block: CssBlock): boolean {
  return /prefers-reduced-motion\s*:\s*reduce/.test(block.prelude);
}

/**
 * Follows a token through its `var()` aliases to the value a browser would compute.
 *
 * @param name - Custom property to resolve
 * @param values - Declared values, later declarations already applied over earlier ones
 * @returns The terminal value, or null when the chain ends nowhere
 */
export function resolveToken(name: string, values: ReadonlyMap<string, string>): string | null {
  const seen = new Set<string>();
  let current: string | undefined = values.get(name);

  while (current !== undefined) {
    const alias = VAR_REFERENCE.exec(current);
    if (alias === null) return current;

    const reference = alias[1] ?? '';
    const fallback = (alias[2] ?? '').trim();

    if (seen.has(reference)) return null;
    seen.add(reference);

    const next = values.get(reference);
    if (next === undefined) return fallback === '' ? null : fallback;
    current = next;
  }

  return null;
}

/**
 * Checks one theme's token stylesheet against the motion contract.
 *
 * @param theme - Label used in the findings
 * @param css - The theme's token stylesheet
 * @returns Every problem found
 *
 * @example
 * auditMotionTokens('vernier', ':root { --oref-motion-fast: 80ms; }');
 * // findings: the other three tokens, and no reduced motion block
 */
export function auditMotionTokens(theme: string, css: string): MotionFinding[] {
  const findings: MotionFinding[] = [];
  const blocks = readBlocks(css);
  const tokenBlocks = blocks.filter(
    (block) =>
      !isReduced(block) &&
      [...block.declarations.keys()].some((name) => name.startsWith('--oref-')),
  );
  const reducedBlocks = blocks.filter(isReduced);

  if (tokenBlocks.length === 0) {
    return [{ level: 'error', theme, reason: 'declares no --oref- tokens at all' }];
  }

  // Every block, not merely the theme as a whole. A theme that declares motion in its light
  // block and not in its dark one leaves the durations unset for half its readers, and a check
  // over the union of the blocks would report that as conforming.
  for (const block of tokenBlocks) {
    const missing = MOTION_TOKENS.filter((name) => !block.declarations.has(name));

    if (missing.length > 0) {
      findings.push({
        level: 'error',
        theme,
        reason: `block "${block.prelude}" declares tokens but not ${missing.join(', ')}`,
      });
    }
  }

  const base = new Map<string, string>();
  for (const block of tokenBlocks) {
    for (const [name, value] of block.declarations) base.set(name, value);
  }

  for (const name of MOTION_DURATIONS) {
    const value = resolveToken(name, base);
    if (value !== null && !DURATION.test(value)) {
      findings.push({
        level: 'error',
        theme,
        reason: `${name} resolves to ${value}, which is not a duration`,
      });
    }
  }

  if (reducedBlocks.length === 0) {
    findings.push({
      level: 'error',
      theme,
      reason:
        'has no @media (prefers-reduced-motion: reduce) block, so its durations keep running for a reader who asked them not to',
    });
    return findings;
  }

  const reduced = new Map(base);
  for (const block of reducedBlocks) {
    for (const [name, value] of block.declarations) reduced.set(name, value);
  }

  for (const name of MOTION_DURATIONS) {
    const value = resolveToken(name, reduced);

    if (value === null) {
      findings.push({
        level: 'error',
        theme,
        reason: `${name} resolves to nothing under reduced motion; the alias chain ends unset or loops`,
      });
      continue;
    }

    if (!ZERO_DURATION.test(value)) {
      findings.push({
        level: 'error',
        theme,
        reason: `${name} resolves to ${value} under reduced motion, and it has to resolve to zero`,
      });
    }
  }

  return findings;
}
