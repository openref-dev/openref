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

/** Removes every `var(--token, fallback)` reference, so only literal remnants are examined. */
function stripVarReferences(value: string): string {
  let previous = '';
  let current = value;

  // Nested `var()` needs more than one pass, and the loop terminates because each pass either
  // removes a reference or changes nothing.
  while (current !== previous) {
    previous = current;
    current = current.replace(/var\(\s*--[a-z0-9-]+\s*(?:,[^()]*)?\)/gi, ' ');
  }

  return current;
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

    const remainder = stripVarReferences(value);
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
