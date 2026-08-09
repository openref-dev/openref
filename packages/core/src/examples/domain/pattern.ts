/**
 * A deliberately small sampler for `pattern`, per SPEC 5.5.
 *
 * The spec asks for constraints to be honoured "where a pattern is trivially satisfiable".
 * That is the whole ambition here: literals, simple character classes, and the four
 * quantifiers applied to them. Anything else returns undefined and the caller falls back to
 * the format or field name value, which it then verifies against the pattern anyway.
 *
 * Two things this module refuses to do. It does not solve regular expressions in general,
 * because a wrong answer that looks right is worse than no answer. It does not compile a
 * pattern that could backtrack catastrophically, because specification documents are input
 * and a generator that hangs on one is a denial of service in the build.
 */

/** Longest pattern this module will look at. Anything longer is treated as not trivial. */
const MAX_PATTERN_LENGTH = 200;

/** Longest string the sampler will build, so an unbounded quantifier cannot run away. */
const MAX_SAMPLE_LENGTH = 64;

/**
 * Reports whether a pattern is safe to execute against a candidate string.
 *
 * The check is structural and conservative: a quantifier applied to a group that itself
 * contains a quantifier is the shape that backtracks exponentially, so any pattern with it is
 * refused rather than analysed further.
 *
 * @param pattern - Pattern as written in the schema
 * @returns True when the pattern may be compiled and tested
 *
 * @example
 * isSafePattern('^[A-Z]{3}$'); // true
 * isSafePattern('^(a+)+$');    // false
 */
export function isSafePattern(pattern: string): boolean {
  if (pattern.length > MAX_PATTERN_LENGTH) return false;
  if (pattern.includes('(?<')) return false;

  for (let index = 0; index < pattern.length; index += 1) {
    if (pattern[index] !== '(') continue;

    const closing = matchingParenthesis(pattern, index);
    if (closing === undefined) return false;

    const body = pattern.slice(index + 1, closing);
    const following = pattern[closing + 1];
    const quantified = following === '+' || following === '*' || following === '{';

    if (quantified && /[+*{]/.test(body.replace(/\\./g, ''))) return false;
  }

  return true;
}

/** Finds the parenthesis that closes the one at `start`, ignoring escaped ones. */
function matchingParenthesis(pattern: string, start: number): number | undefined {
  let depth = 0;

  for (let index = start; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === '\\') {
      index += 1;
      continue;
    }
    if (character === '(') depth += 1;
    if (character === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return undefined;
}

/**
 * Tests a candidate string against a pattern, refusing unsafe patterns.
 *
 * @param pattern - Pattern as written in the schema
 * @param candidate - String to test
 * @returns True when the pattern is safe and the candidate matches
 */
export function matchesPattern(pattern: string, candidate: string): boolean {
  if (!isSafePattern(pattern)) return false;

  let expression: RegExp;
  try {
    expression = new RegExp(pattern, 'u');
  } catch {
    try {
      expression = new RegExp(pattern);
    } catch {
      return false;
    }
  }

  return expression.test(candidate);
}

/** One atom of a pattern the sampler understands, with how many times it repeats. */
interface Atom {
  readonly sample: string;
  readonly minimum: number;
}

/** Characters produced for the shorthand classes. */
const SHORTHAND: Readonly<Record<string, string>> = {
  d: '0',
  w: 'a',
  s: ' ',
  D: 'a',
  W: '-',
  S: 'a',
};

/**
 * Builds the shortest string a trivially satisfiable pattern accepts.
 *
 * Understood: literal characters, `.`, escaped literals, the shorthand classes, a character
 * class with literal members and ranges, and the quantifiers `?`, `*`, `+` and `{n,m}`.
 * Alternation, groups, back references and anchors other than a leading `^` and a trailing `$`
 * make the pattern non trivial.
 *
 * @param pattern - Pattern as written in the schema
 * @returns A string the pattern accepts, or undefined when the pattern is not trivial
 *
 * @example
 * sampleFromPattern('^[A-Z]{3}$');   // 'AAA'
 * sampleFromPattern('^\\d{4}-\\d{2}$'); // '0000-00'
 * sampleFromPattern('^(a|b)+$');     // undefined
 */
export function sampleFromPattern(pattern: string): string | undefined {
  if (pattern.length > MAX_PATTERN_LENGTH) return undefined;

  let body = pattern;
  if (body.startsWith('^')) body = body.slice(1);
  if (body.endsWith('$') && !body.endsWith('\\$')) body = body.slice(0, -1);

  const atoms = parseAtoms(body);
  if (atoms === undefined) return undefined;

  let sample = '';
  for (const atom of atoms) {
    sample += atom.sample.repeat(atom.minimum);
    if (sample.length > MAX_SAMPLE_LENGTH) return undefined;
  }

  return matchesPattern(pattern, sample) ? sample : undefined;
}

function parseAtoms(body: string): Atom[] | undefined {
  const atoms: Atom[] = [];
  let index = 0;

  while (index < body.length) {
    const parsed = parseAtom(body, index);
    if (parsed === undefined) return undefined;

    const quantified = applyQuantifier(body, parsed.next, parsed.sample);
    if (quantified === undefined) return undefined;

    atoms.push({ sample: parsed.sample, minimum: quantified.minimum });
    index = quantified.next;
  }

  return atoms;
}

/** Reads one atom and reports the character it stands for. */
function parseAtom(body: string, index: number): { sample: string; next: number } | undefined {
  const character = body[index];
  if (character === undefined) return undefined;

  if (character === '\\') {
    const escaped = body[index + 1];
    if (escaped === undefined) return undefined;
    return { sample: SHORTHAND[escaped] ?? escaped, next: index + 2 };
  }

  if (character === '[') {
    return parseCharacterClass(body, index);
  }

  if (character === '.') return { sample: 'a', next: index + 1 };

  // Anything that structures the pattern rather than matching a character is not trivial.
  if ('()|^$'.includes(character)) return undefined;
  if ('*+?{'.includes(character)) return undefined;

  return { sample: character, next: index + 1 };
}

/** Reads a character class and reports its first acceptable member. */
function parseCharacterClass(
  body: string,
  index: number,
): { sample: string; next: number } | undefined {
  let cursor = index + 1;
  if (body[cursor] === '^') return undefined;

  let first: string | undefined;

  while (cursor < body.length && body[cursor] !== ']') {
    const character = body[cursor];
    if (character === undefined) return undefined;

    if (character === '\\') {
      const escaped = body[cursor + 1];
      if (escaped === undefined) return undefined;
      first ??= SHORTHAND[escaped] ?? escaped;
      cursor += 2;
      continue;
    }

    if (body[cursor + 1] === '-' && body[cursor + 2] !== undefined && body[cursor + 2] !== ']') {
      first ??= character;
      cursor += 3;
      continue;
    }

    first ??= character;
    cursor += 1;
  }

  if (body[cursor] !== ']' || first === undefined) return undefined;

  return { sample: first, next: cursor + 1 };
}

/** Reads the quantifier following an atom and reports how few times the atom may appear. */
function applyQuantifier(
  body: string,
  index: number,
  sample: string,
): { minimum: number; next: number } | undefined {
  const character = body[index];

  if (character === '?' || character === '*') return { minimum: 0, next: index + 1 };
  if (character === '+') return { minimum: 1, next: index + 1 };

  if (character === '{') {
    const closing = body.indexOf('}', index);
    if (closing === -1) return undefined;

    const inside = body.slice(index + 1, closing);
    const match = /^(\d+)(,(\d*)?)?$/.exec(inside);
    if (match === null) return undefined;

    const minimum = Number(match[1]);
    if (minimum * sample.length > MAX_SAMPLE_LENGTH) return undefined;

    return { minimum, next: closing + 1 };
  }

  return { minimum: 1, next: index };
}
