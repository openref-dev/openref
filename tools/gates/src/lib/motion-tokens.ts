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
 * IT EVALUATES THE CASCADE, NOT ONE BLOCK. A theme's stylesheets are read in the order the
 * theme loads them, and the winning declaration of each token is the one CSS would pick:
 * highest specificity, then last in source order. Checking a reduced motion block on its own is
 * exactly how this passes while the page keeps animating, and the shape it takes is real rather
 * than hypothetical. The dark block of a scheme aware theme is
 * `:root:not([data-oref-color-scheme='light'])`, specificity 0,2,0. A reduced motion block on a
 * plain `:root` is 0,1,0 and loses to it, so a reader who wants a dark interface AND no
 * animation keeps the animation. Nothing about the file looks wrong.
 *
 * RESOLUTION, NOT EQUALITY. A theme may write `0s` or point the duration at the zero token, and
 * the zero token may itself be an alias. What is checked is where the chain ends, because that
 * is what a browser computes and what a reader gets.
 *
 * THE ONE APPROXIMATION, stated rather than buried: specificity is compared as though every
 * token block matched the same element. That is true of the selectors a token stylesheet
 * actually uses, `:root` and the colour scheme attribute, and it errs towards reporting a
 * conflict that a browser might not have, which is the safe direction for this check.
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

/** One stylesheet of a theme, in the order the theme loads it. */
export interface StyleSource {
  /** Repository relative path, used in findings. */
  readonly file: string;
  readonly css: string;
}

/** A problem found in one theme's stylesheets. */
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

/** One declaration, with everything the cascade decides on. */
interface Declaration {
  readonly token: string;
  readonly value: string;
  /** True when the declaration only applies under `prefers-reduced-motion: reduce`. */
  readonly reduced: boolean;
  /** Specificity of the block's selector, packed so it compares as one number. */
  readonly specificity: number;
  /** Position across every stylesheet of the theme, in load order. */
  readonly order: number;
  readonly prelude: string;
  readonly file: string;
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

/** The selector of a block, which is the last part of its at-rule chain. */
function selectorOf(prelude: string): string {
  const at = prelude.lastIndexOf('@media');
  if (at === -1) return prelude;

  const after = prelude.slice(at);
  const closing = after.indexOf(')');
  return closing === -1 ? '' : after.slice(closing + 1).trim();
}

/**
 * Specificity of one compound selector, packed as `a * 10000 + b * 100 + c`.
 *
 * Implements the parts of the rule a token stylesheet can reach: ids, then classes, attributes
 * and pseudo-classes, then elements. A functional pseudo-class contributes the specificity of
 * its argument and not its own, per the selectors specification, except `:where()`, which
 * contributes nothing. That is not pedantry here: the dark block of every theme in this
 * repository is written with `:not()`.
 *
 * @param selector - One selector, without commas
 * @returns The packed specificity
 *
 * @example
 * specificityOf(':root:not([data-oref-color-scheme=\'light\'])'); // 200, that is 0,2,0
 */
export function specificityOf(selector: string): number {
  let rest = selector;
  let inner = 0;

  // Functional pseudo-classes first, so their arguments are counted and their own name is not.
  const functional = /:(not|is|has|where)\(/i;
  let guard = 0;

  while (functional.test(rest) && guard < 50) {
    guard += 1;
    const match = functional.exec(rest);
    if (match === null) break;

    const open = match.index + match[0].length - 1;
    let depth = 0;
    let close = open;

    while (close < rest.length) {
      if (rest[close] === '(') depth += 1;
      else if (rest[close] === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
      close += 1;
    }

    const argument = rest.slice(open + 1, close);
    if ((match[1] ?? '').toLowerCase() !== 'where') {
      inner += Math.max(0, ...argument.split(',').map((part) => specificityOf(part.trim())));
    }
    rest = `${rest.slice(0, match.index)} ${rest.slice(close + 1)}`;
  }

  const ids = (rest.match(/#[\w-]+/g) ?? []).length;
  const classes = (rest.match(/\.[\w-]+|\[[^\]]*\]|:{1}(?!:)[a-zA-Z-]+/g) ?? []).length;
  const elements = (rest.match(/(?:^|[\s>+~])([a-zA-Z][\w-]*)/g) ?? []).length;

  return ids * 10_000 + classes * 100 + elements + inner;
}

/** Specificity of a selector list: the strongest of its parts. */
function listSpecificity(selector: string): number {
  const parts = selector
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');

  return parts.length === 0 ? 0 : Math.max(...parts.map(specificityOf));
}

/** Every declaration of every motion token, across a theme's stylesheets in load order. */
function declarationsOf(sources: readonly StyleSource[]): Declaration[] {
  const found: Declaration[] = [];
  let order = 0;

  for (const source of sources) {
    for (const block of readBlocks(source.css)) {
      const specificity = listSpecificity(selectorOf(block.prelude));
      const reduced = isReduced(block);

      for (const [token, value] of block.declarations) {
        order += 1;
        found.push({
          token,
          value,
          reduced,
          specificity,
          order,
          prelude: block.prelude,
          file: source.file,
        });
      }
    }
  }

  return found;
}

/**
 * The declaration a browser would apply, per token.
 *
 * @param declarations - Every declaration, in load order
 * @param underReduce - Whether the reduced motion query matches
 * @returns The winning declaration per token
 */
function winners(
  declarations: readonly Declaration[],
  underReduce: boolean,
): Map<string, Declaration> {
  const winning = new Map<string, Declaration>();

  for (const declaration of declarations) {
    if (declaration.reduced && !underReduce) continue;

    const current = winning.get(declaration.token);
    if (
      current === undefined ||
      declaration.specificity > current.specificity ||
      (declaration.specificity === current.specificity && declaration.order > current.order)
    ) {
      winning.set(declaration.token, declaration);
    }
  }

  return winning;
}

/**
 * Follows a token through its `var()` aliases to the value a browser would compute.
 *
 * @param name - Custom property to resolve
 * @param values - Winning value per token
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

function valuesOf(winning: ReadonlyMap<string, Declaration>): Map<string, string> {
  return new Map([...winning].map(([token, declaration]) => [token, declaration.value]));
}

/**
 * Checks one theme's stylesheets against the motion contract.
 *
 * @param theme - Label used in the findings
 * @param sources - The theme's stylesheets, in the order the theme loads them
 * @returns Every problem found
 *
 * @example
 * auditMotionTokens('vernier', [{ file: 'tokens.css', css }, { file: 'theme.css', css }]);
 */
export function auditMotionTokens(theme: string, sources: readonly StyleSource[]): MotionFinding[] {
  const findings: MotionFinding[] = [];
  const blocks = sources.flatMap((source) =>
    readBlocks(source.css).map((block) => ({ ...block, file: source.file })),
  );
  const anyTokens = blocks.some((block) =>
    [...block.declarations.keys()].some((name) => name.startsWith('--oref-')),
  );
  const motionBlocks = blocks.filter(
    (block) => !isReduced(block) && MOTION_TOKENS.some((name) => block.declarations.has(name)),
  );
  const reducedBlocks = blocks.filter(isReduced);

  if (!anyTokens) {
    return [{ level: 'error', theme, reason: 'declares no --oref- tokens at all' }];
  }

  if (motionBlocks.length === 0) {
    return [{ level: 'error', theme, reason: 'declares no motion token at all' }];
  }

  // PER BLOCK, not merely per theme. A theme that declares motion in its light block and not in
  // its dark one leaves the durations at the light values for half its readers, and a check over
  // the union of the blocks would report that as conforming.
  //
  // The rule is scoped to a block that declares at least one motion token, rather than to any
  // block that declares any token at all: a rule that sets one layout token on one component has
  // nothing to say about motion, and demanding four durations of it would be noise that trains
  // the reader to ignore this gate.
  for (const block of motionBlocks) {
    const missing = MOTION_TOKENS.filter((name) => !block.declarations.has(name));

    if (missing.length > 0) {
      findings.push({
        level: 'error',
        theme,
        reason: `${block.file} block "${block.prelude}" declares tokens but not ${missing.join(', ')}`,
      });
    }
  }

  const declarations = declarationsOf(sources);
  const base = valuesOf(winners(declarations, false));

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

  const winning = winners(declarations, true);
  const reduced = valuesOf(winning);

  for (const name of MOTION_DURATIONS) {
    const value = resolveToken(name, reduced);
    const applied = winning.get(name);

    if (value === null) {
      findings.push({
        level: 'error',
        theme,
        reason: `${name} resolves to nothing under reduced motion; the alias chain ends unset or loops`,
      });
      continue;
    }

    if (!ZERO_DURATION.test(value)) {
      const where =
        applied === undefined
          ? ''
          : `; the declaration that wins is ${applied.file} "${applied.prelude}"${
              applied.reduced ? '' : ', which is not the reduced motion block'
            }`;

      findings.push({
        level: 'error',
        theme,
        reason: `${name} resolves to ${value} under reduced motion, and it has to resolve to zero${where}`,
      });
    }
  }

  return findings;
}
