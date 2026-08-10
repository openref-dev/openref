/**
 * Static scan for hardcoded design values in a stylesheet.
 *
 * STANDARDS 11 and BUILD T009: the default theme reads only tokens, and a hardcoded colour,
 * length or font stack fails the build. The rule exists because L0 theming is a promise: a
 * consumer restyles the reference by setting custom properties, and one literal that escaped
 * is a value they cannot reach.
 *
 * One file is exempt, the generated token stylesheet, because that is where the values are
 * defined. Exempting anything else would defeat the check.
 *
 * THE RULE ON `var()` FALLBACKS: a literal fallback is banned outright.
 *
 * `color: var(--oref-color-fg, #0b0d10)` is a hardcoded colour. It does not look like one,
 * which is the whole problem: a fallback reads as a safety net rather than as a value, and it
 * is what actually ships whenever the token is not set. The alternative rule, allowing a
 * fallback for a token that is guaranteed defined, was considered and rejected on three
 * grounds:
 *
 * 1. It is unenforceable here. Whether a token is set depends on which stylesheets a host
 *    loaded and on what an L0 consumer overrode, and neither is visible to a static scan.
 * 2. For a token this project ships, the fallback is dead code: `tokens.css` defines every
 *    token, and `tokens.spec.ts` pins that file against the token set. A fallback beside a
 *    defined token is a second, unpinned copy of the value.
 * 3. For a token this project does not ship, the fallback is the value, and calling it a
 *    fallback does not make it a token.
 *
 * So the fallback is kept and scanned rather than stripped. A fallback that is itself
 * `var(--oref-*)` is fine: aliasing one token to another is not a hardcoded value. Simple
 * rules survive contact with three themes; conditional ones do not.
 */

/** One hardcoded value found in a stylesheet. */
export interface CssLiteral {
  readonly kind: 'color' | 'length' | 'font';
  readonly property: string;
  readonly value: string;
  readonly line: number;
  readonly reason: string;
}

/**
 * Colour keywords a stylesheet may use, because none of them is a design decision.
 *
 * `transparent` and `currentColor` take their colour from elsewhere, and the system colours
 * are resolved by the user agent from the user's own settings.
 */
const ALLOWED_COLOR_KEYWORDS = new Set([
  'transparent',
  'currentcolor',
  'inherit',
  'initial',
  'unset',
  'revert',
  'none',
  'canvas',
  'canvastext',
  'linktext',
  'visitedtext',
  'activetext',
  'buttonface',
  'buttontext',
  'field',
  'fieldtext',
  'highlight',
  'highlighttext',
  'accentcolor',
  'accentcolortext',
]);

/**
 * Every named colour CSS defines, so a stylesheet cannot slip one past the hex check.
 *
 * The list is complete rather than a sample: a partial list would pass `rebeccapurple` and
 * fail `red`, which reads as the rule being unreliable rather than as the file being wrong.
 */
const NAMED_COLORS = new Set([
  'aliceblue',
  'antiquewhite',
  'aqua',
  'aquamarine',
  'azure',
  'beige',
  'bisque',
  'black',
  'blanchedalmond',
  'blue',
  'blueviolet',
  'brown',
  'burlywood',
  'cadetblue',
  'chartreuse',
  'chocolate',
  'coral',
  'cornflowerblue',
  'cornsilk',
  'crimson',
  'cyan',
  'darkblue',
  'darkcyan',
  'darkgoldenrod',
  'darkgray',
  'darkgreen',
  'darkgrey',
  'darkkhaki',
  'darkmagenta',
  'darkolivegreen',
  'darkorange',
  'darkorchid',
  'darkred',
  'darksalmon',
  'darkseagreen',
  'darkslateblue',
  'darkslategray',
  'darkslategrey',
  'darkturquoise',
  'darkviolet',
  'deeppink',
  'deepskyblue',
  'dimgray',
  'dimgrey',
  'dodgerblue',
  'firebrick',
  'floralwhite',
  'forestgreen',
  'fuchsia',
  'gainsboro',
  'ghostwhite',
  'gold',
  'goldenrod',
  'gray',
  'green',
  'greenyellow',
  'grey',
  'honeydew',
  'hotpink',
  'indianred',
  'indigo',
  'ivory',
  'khaki',
  'lavender',
  'lavenderblush',
  'lawngreen',
  'lemonchiffon',
  'lightblue',
  'lightcoral',
  'lightcyan',
  'lightgoldenrodyellow',
  'lightgray',
  'lightgreen',
  'lightgrey',
  'lightpink',
  'lightsalmon',
  'lightseagreen',
  'lightskyblue',
  'lightslategray',
  'lightslategrey',
  'lightsteelblue',
  'lightyellow',
  'lime',
  'limegreen',
  'linen',
  'magenta',
  'maroon',
  'mediumaquamarine',
  'mediumblue',
  'mediumorchid',
  'mediumpurple',
  'mediumseagreen',
  'mediumslateblue',
  'mediumspringgreen',
  'mediumturquoise',
  'mediumvioletred',
  'midnightblue',
  'mintcream',
  'mistyrose',
  'moccasin',
  'navajowhite',
  'navy',
  'oldlace',
  'olive',
  'olivedrab',
  'orange',
  'orangered',
  'orchid',
  'palegoldenrod',
  'palegreen',
  'paleturquoise',
  'palevioletred',
  'papayawhip',
  'peachpuff',
  'peru',
  'pink',
  'plum',
  'powderblue',
  'purple',
  'rebeccapurple',
  'red',
  'rosybrown',
  'royalblue',
  'saddlebrown',
  'salmon',
  'sandybrown',
  'seagreen',
  'seashell',
  'sienna',
  'silver',
  'skyblue',
  'slateblue',
  'slategray',
  'slategrey',
  'snow',
  'springgreen',
  'steelblue',
  'tan',
  'teal',
  'thistle',
  'tomato',
  'turquoise',
  'violet',
  'wheat',
  'white',
  'whitesmoke',
  'yellow',
  'yellowgreen',
]);

/** Colour functions. A literal one is a hardcoded colour whatever the syntax. */
const COLOR_FUNCTION = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\s*\(/i;

const HEX_COLOR = /#[0-9a-fA-F]{3,8}\b/;

/**
 * Units that make a value a design decision.
 *
 * `%`, `fr`, `vh`, `vw`, `dvh`, `dvw`, `s` and `ms` are deliberately absent. A percentage or
 * a grid fraction expresses structure, a viewport unit expresses the viewport, and a duration
 * that is not a token would be caught by the motion tokens instead. Flagging them would push
 * a stylesheet into inventing tokens for things a design system does not own.
 */
const DESIGN_LENGTH = /(?<![\w#-])-?(?:\d+\.?\d*|\.\d+)(px|rem|em|pt|pc|ch|ex|cm|mm|in|q)\b/i;

/** Declarations whose value is a font stack. */
const FONT_PROPERTY = /^font(?:-family)?$/;

/** Values a font property may hold without naming a family. */
const ALLOWED_FONT_VALUES = new Set(['inherit', 'initial', 'unset', 'revert']);

/** Strips comments so a value inside one is never reported. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '));
}

/**
 * Index of the closing parenthesis matching the one at `open`, or -1 when there is none.
 *
 * Counting rather than matching a regular expression, because a fallback can hold a function
 * of its own: `var(--x, rgba(0, 0, 0, 0.5))` has two commas and two closing parentheses, and
 * only one of each belongs to the reference.
 */
function matchingParenthesis(value: string, open: number): number {
  let depth = 0;

  for (let at = open; at < value.length; at += 1) {
    const character = value[at];
    if (character === '(') depth += 1;
    else if (character === ')') {
      depth -= 1;
      if (depth === 0) return at;
    }
  }

  return -1;
}

/** Index of the first comma at nesting depth zero, or -1 when the value holds none. */
function topLevelComma(value: string): number {
  let depth = 0;

  for (let at = 0; at < value.length; at += 1) {
    const character = value[at];
    if (character === '(') depth += 1;
    else if (character === ')') depth -= 1;
    else if (character === ',' && depth === 0) return at;
  }

  return -1;
}

/** True when `var` at this position is a whole word rather than the tail of an identifier. */
function isWordStart(value: string, at: number): boolean {
  if (at === 0) return true;
  const before = value[at - 1] ?? '';
  return !/[\w-]/.test(before);
}

/**
 * Replaces every `var()` reference with its fallback, recursively.
 *
 * THE FALLBACK IS KEPT, NOT DISCARDED. Stripping the whole reference was the first version of
 * this function and it left a hole exactly where a hardcoded value is most likely to survive:
 * `color: var(--oref-color-fg, #0b0d10)` reads as a safety net rather than as a value, which
 * is what makes it easy to write and easy to miss. What ships is the fallback, whenever the
 * token happens not to be set, so the fallback is a value like any other and is scanned like
 * one.
 *
 * The token name itself is dropped, since a reference to a token is the thing this gate wants
 * to see. A fallback that is itself a `var()` is expanded in turn, so nesting buys nothing.
 *
 * @param value - A declaration value
 * @returns The value with token names removed and every fallback left in place
 */
export function expandVarFallbacks(value: string): string {
  let out = '';
  let cursor = 0;

  for (;;) {
    let at = value.indexOf('var(', cursor);
    while (at !== -1 && !isWordStart(value, at)) at = value.indexOf('var(', at + 1);

    if (at === -1) {
      out += value.slice(cursor);
      return out;
    }

    out += value.slice(cursor, at);

    const open = at + 'var'.length;
    const close = matchingParenthesis(value, open);
    if (close === -1) {
      // Unbalanced. Keep the remainder verbatim rather than assuming what was meant: a typo
      // must not become a place where a value hides.
      out += ` ${value.slice(open + 1)}`;
      return out;
    }

    const inner = value.slice(open + 1, close);
    const comma = topLevelComma(inner);
    out += comma === -1 ? ' ' : ` ${expandVarFallbacks(inner.slice(comma + 1))} `;
    cursor = close + 1;
  }
}

function isColorLiteral(remainder: string): boolean {
  if (HEX_COLOR.test(remainder)) return true;
  if (COLOR_FUNCTION.test(remainder)) return true;

  return remainder
    .split(/[\s,()/]+/)
    .filter((word) => word !== '')
    .some((word) => {
      const lowered = word.toLowerCase();
      return NAMED_COLORS.has(lowered) && !ALLOWED_COLOR_KEYWORDS.has(lowered);
    });
}

/**
 * Finds hardcoded design values in a stylesheet.
 *
 * @param css - The stylesheet text
 * @returns Every literal found, in source order
 *
 * @example
 * findCssLiterals('.a { color: #0b0d10; }');
 */
export function findCssLiterals(css: string): CssLiteral[] {
  const found: CssLiteral[] = [];
  const lines = stripComments(css).split('\n');

  lines.forEach((line, index) => {
    const declaration = /^\s*([a-z-]+)\s*:\s*([^;{}]+);?\s*$/i.exec(line);
    if (declaration === null) return;

    const property = declaration[1] ?? '';
    const value = (declaration[2] ?? '').trim();

    // A custom property declaration is a definition, not a use. Only the generated token
    // stylesheet declares them, and that file is exempt as a whole.
    if (property.startsWith('--')) return;

    const remainder = expandVarFallbacks(value);
    const at = index + 1;

    if (isColorLiteral(remainder)) {
      found.push({
        kind: 'color',
        property,
        value,
        line: at,
        reason: 'a colour must come from a --oref-color-* token',
      });
    }

    const length = DESIGN_LENGTH.exec(remainder);
    if (length !== null) {
      found.push({
        kind: 'length',
        property,
        value,
        line: at,
        reason: `the length ${length[0]} must come from a --oref-* token`,
      });
    }

    if (FONT_PROPERTY.test(property)) {
      const rest = remainder.trim().toLowerCase();
      if (rest !== '' && !ALLOWED_FONT_VALUES.has(rest)) {
        found.push({
          kind: 'font',
          property,
          value,
          line: at,
          reason: 'a font stack must come from a --oref-font-family-* token',
        });
      }
    }
  });

  return found;
}

/**
 * A literal found inside the value of a custom property in the token stylesheet.
 *
 * THE RULE: in a token declaration, a colour that is the whole value is a definition, and a
 * colour that is one part of a composite value is a use. A use must be a `var()` reference.
 *
 * `--oref-color-line-edge: #bfc9d2` defines that colour and is exactly what the token
 * stylesheet is for. `--oref-layout-tick: repeating-linear-gradient(180deg, #bfc9d2 0 1px, ...)`
 * uses it, and writing the hex there makes a second copy of a value a token already defines,
 * unpinned by anything: the two drift the moment the palette moves. That declaration is real,
 * it shipped in the vernier handover, and `findCssLiterals` reported nothing for it, twice over.
 * It skips any property beginning with `--`, on the reasoning that a custom property is a
 * definition, and the token stylesheet is exempt as a whole in any case.
 *
 * THE BROADER RULE WAS MEASURED AND REJECTED. "A colour literal that appears more than once in
 * the token stylesheet is a second copy" sounds like the same rule and is not. Run over the
 * real palette it produces eleven findings on a correct file: `#8a5200` is the whole value of
 * six tokens, among them `accent-runtime`, `focus-color`, `state-warn-fg` and `drift-warn-fg`.
 * Those are six semantic names that agree on a colour today. Forcing five of them to alias the
 * sixth would assert that the focus ring is the runtime accent, which the design does not
 * claim and which the next palette would falsify. So the check is about composition, not about
 * repetition, and where a composite does repeat a defined colour the finding names the token
 * that defines it.
 *
 * Colour only, deliberately. The lengths inside that same gradient, `1px` and `8px`, are the
 * geometry of the ruler, and the contract carries no token for either. Flagging them would
 * force a stylesheet to invent tokens the design system does not have, which is the failure
 * mode the `%` and `fr` exemptions above already avoid.
 */
export interface TokenValueLiteral {
  /** Custom property whose value holds the literal. */
  readonly property: string;
  readonly value: string;
  /** The colour, as written. */
  readonly literal: string;
  readonly line: number;
  /** A token in the same block whose whole value is that colour, when there is one. */
  readonly definedBy?: string;
  readonly definedAtLine?: number;
  readonly reason: string;
}

/** One custom property declaration, which prettier may have wrapped across several lines. */
interface TokenDeclaration {
  readonly property: string;
  readonly value: string;
  readonly line: number;
  readonly block: number;
}

/**
 * Reads every custom property declaration, spanning lines.
 *
 * A line based scan would miss the one declaration this check exists for: the gradient is over
 * a hundred characters, so prettier wraps it, and every hex in it sits on a line that is not a
 * declaration.
 */
function tokenDeclarations(css: string): TokenDeclaration[] {
  const text = stripComments(css);
  const out: TokenDeclaration[] = [];
  let block = 0;
  let line = 1;
  let at = 0;

  while (at < text.length) {
    const character = text[at] ?? '';

    if (character === '\n') {
      line += 1;
      at += 1;
      continue;
    }
    if (character === '{' || character === '}') {
      block += 1;
      at += 1;
      continue;
    }
    if (!(character === '-' && text.startsWith('--', at))) {
      at += 1;
      continue;
    }

    const colon = text.indexOf(':', at);
    const property = colon === -1 ? '' : text.slice(at, colon).trim();
    if (colon === -1 || !/^--[\w-]+$/.test(property)) {
      at += 1;
      continue;
    }

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
    out.push({ property, value, line, block });
    line += (text.slice(at, end).match(/\n/g) ?? []).length;
    at = end;
  }

  return out;
}

const WHOLE_HEX = /^#[0-9a-fA-F]{3,8}$/;
const WHOLE_COLOR_FUNCTION =
  /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\([^()]*(?:\([^()]*\)[^()]*)*\)$/i;

/** True when the value is a colour and nothing else, which makes the declaration a definition. */
function isWholeValueColor(value: string): boolean {
  if (WHOLE_HEX.test(value)) return true;
  if (WHOLE_COLOR_FUNCTION.test(value)) return true;

  const lowered = value.toLowerCase();
  return NAMED_COLORS.has(lowered) && !ALLOWED_COLOR_KEYWORDS.has(lowered);
}

/** Every colour written literally in a value, in source order. */
function colorLiterals(value: string): string[] {
  const found: string[] = [];

  for (const match of value.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) found.push(match[0]);
  for (const match of value.matchAll(
    /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix)\s*\([^()]*(?:\([^()]*\)[^()]*)*\)/gi,
  )) {
    found.push(match[0]);
  }
  for (const word of value.split(/[\s,()/]+/)) {
    const lowered = word.toLowerCase();
    if (NAMED_COLORS.has(lowered) && !ALLOWED_COLOR_KEYWORDS.has(lowered)) found.push(word);
  }

  return found;
}

/**
 * Finds a colour written into a composite token value.
 *
 * @param css - The token stylesheet
 * @returns Every colour used rather than defined, in source order
 *
 * @example
 * findTokenValueLiterals('.a { --x: linear-gradient(#fff 0 1px); }');
 */
export function findTokenValueLiterals(css: string): TokenValueLiteral[] {
  const declarations = tokenDeclarations(css);
  const definitions = new Map<string, TokenDeclaration>();

  for (const declaration of declarations) {
    if (!isWholeValueColor(declaration.value)) continue;
    const key = `${String(declaration.block)}|${declaration.value.toLowerCase()}`;
    if (!definitions.has(key)) definitions.set(key, declaration);
  }

  const found: TokenValueLiteral[] = [];

  for (const declaration of declarations) {
    if (isWholeValueColor(declaration.value)) continue;

    // The token name is dropped and the fallback kept, exactly as in a normal declaration: a
    // literal fallback inside a token value is a literal wherever it sits.
    const remainder = expandVarFallbacks(declaration.value);

    for (const literal of colorLiterals(remainder)) {
      const definition = definitions.get(`${String(declaration.block)}|${literal.toLowerCase()}`);

      found.push({
        property: declaration.property,
        value: declaration.value,
        literal,
        line: declaration.line,
        ...(definition === undefined
          ? {}
          : { definedBy: definition.property, definedAtLine: definition.line }),
        reason:
          definition === undefined
            ? `the colour ${literal} is written into a composite value; a token value composes other tokens, never a literal`
            : `the colour ${literal} is already defined by ${definition.property} on line ${String(definition.line)}; reference it with var(${definition.property})`,
      });
    }
  }

  return found;
}
