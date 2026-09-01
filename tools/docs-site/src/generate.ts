import { readFileSync, writeFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SLOT_NAMES, SERVER_RESOLVED_SLOTS } from '@openref/vue';
import { BUILD_TARGETS, DIRECT_TARGETS, PROXY_CONFIG_TARGETS } from '@openref/static';
import { claimsFor, type ClaimContext } from './claims.js';
export { REPOSITORY_ROOT } from './index.js';
import { REPOSITORY_ROOT } from './index.js';

/**
 * The generated regions of the documentation, and what they are generated from.
 *
 * TWO KINDS OF SENTENCE ARE GENERATED AND NOTHING ELSE IS. A claim about what a reader will see
 * comes from `claims.ts`, which is also what the promise suite asserts against a page. A number
 * stated beside the thing it counts comes from counting that thing. Everything else in the
 * documentation is prose and is free, which is the whole point of drawing the line here: a
 * checker that tried to read every sentence would be a checker nobody can rely on, and the
 * sixth review found five spellings that walked around exactly such a checker.
 *
 * A REGION IS OWNED BY THIS FILE AND NOT BY A WRITER. `<!-- gen: <spec> -->` to `<!-- /gen -->`
 * is machine written, in place, so the committed markdown a reader sees on a repository page is
 * the expanded text rather than a template full of placeholders. `pnpm docs:build` expands every
 * surface before it composes the site, and `documentation-generated.spec.ts` expands them again
 * and fails if anything moves, so a stale region cannot ship.
 *
 * THE COUNTS ARE COUNTED FROM THE ARTEFACT, NOT FROM A SECOND LIST. A table's rows, a fenced
 * block's lines, a list's items and a section's subheadings are all there in the same file; the
 * four product counts read the product's own exported lists. The sixth count error, "Five
 * properties" over six sections in the security chapter, was found by a reviewer rather than by
 * any of the five plants, in the one chapter where a wrong number is worst.
 */

/** How a region says what belongs in it. */
type Spec =
  | { readonly kind: 'claims'; readonly context: ClaimContext }
  | { readonly kind: 'count'; readonly source: string };

/** Reads one region's spec, or refuses it by name. */
function parseSpec(text: string): Spec {
  const claims = /^claims:(\S+)$/.exec(text);
  if (claims !== null) {
    const context = claims[1] ?? '';
    if (
      context === 'bare-mount' ||
      context === 'printed-block' ||
      context === 'errors-collector' ||
      context === 'throttler-package'
    ) {
      return { kind: 'claims', context };
    }
    throw new Error(`no claim context is named "${context}"`);
  }

  const count = /^count:(\S+)$/.exec(text);
  if (count !== null) return { kind: 'count', source: count[1] ?? '' };

  throw new Error(`no generator is defined for the region "${text}"`);
}

/** The number words the prose uses, so a generated count is spelled the way a sentence needs. */
const WORDS: readonly string[] = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
];

/**
 * A number as the prose spells it: a word up to twelve, digits above.
 *
 * TWENTY ONE IS SPELLED OUT because the slot list is the one count above twelve the prose
 * states, and `21 positions are registered` reads as a version number in the middle of a
 * sentence.
 *
 * @param value - The number
 * @param capital - Whether it opens a sentence
 * @returns The spelling
 */
function spell(value: number, capital: boolean): string {
  const word =
    value === 21
      ? 'twenty one'
      : value < WORDS.length
        ? (WORDS[value] ?? String(value))
        : String(value);

  return capital ? word.charAt(0).toUpperCase() + word.slice(1) : word;
}

/** Counts the rows of the first table at or after a position, or before it. */
function tableRows(lines: readonly string[], from: number, back = false): number {
  const order = back
    ? [...lines.keys()].filter((at) => at < from).reverse()
    : [...lines.keys()].filter((at) => at >= from);

  for (const at of order) {
    if (!/^\|[ :\-|]+\|$/.test(lines[at] ?? '')) continue;
    if (!(lines[at - 1] ?? '').startsWith('|')) continue;

    let rows = 0;
    for (let row = at + 1; row < lines.length && (lines[row] ?? '').startsWith('|'); row += 1) {
      rows += 1;
    }
    return rows;
  }
  throw new Error(`no table ${back ? 'precedes' : 'follows'} the region`);
}

/** Counts the non-empty lines of the nearest fenced block, after a position or before it. */
function fenceLines(lines: readonly string[], from: number, back = false): number {
  const order = back
    ? [...lines.keys()].filter((at) => at < from).reverse()
    : [...lines.keys()].filter((at) => at >= from);

  for (const at of order) {
    if (!(lines[at] ?? '').startsWith('```')) continue;
    if (back) {
      // Walking back, the first fence met is the block's closing one, so the count runs upward.
      let count = 0;
      for (let row = at - 1; row >= 0 && !(lines[row] ?? '').startsWith('```'); row -= 1) {
        if ((lines[row] ?? '').trim() !== '') count += 1;
      }
      return count;
    }

    let count = 0;
    for (let row = at + 1; row < lines.length && !(lines[row] ?? '').startsWith('```'); row += 1) {
      if ((lines[row] ?? '').trim() !== '') count += 1;
    }
    return count;
  }
  throw new Error(`no fenced block ${back ? 'precedes' : 'follows'} the region`);
}

/**
 * Counts the items of the first list at or after a position, bulleted or numbered.
 *
 * A CONTINUATION LINE IS PART OF ITS ITEM AND NOT THE END OF THE LIST. The first version broke
 * on the first line that did not open an item, so every list whose items wrap counted one, and
 * three chapters were about to be told they had one thing to say.
 */
function listItems(lines: readonly string[], from: number): number {
  let count = 0;
  let started = false;

  for (let at = from; at < lines.length; at += 1) {
    const line = lines[at] ?? '';

    if (/^(?:[-*] |\d+\. )/.test(line)) {
      count += 1;
      started = true;
      continue;
    }
    if (!started) continue;
    // An indented line continues the item above it; a blank line may separate two items.
    if (line.trim() === '' || /^\s+\S/.test(line)) continue;
    break;
  }

  if (count === 0) throw new Error('no list follows the region');
  return count;
}

/** Counts the third level headings under the second level heading a position is inside. */
function sectionsHere(lines: readonly string[], from: number): number {
  let count = 0;

  for (let at = from; at < lines.length; at += 1) {
    const line = lines[at] ?? '';
    if (line.startsWith('## ')) break;
    if (line.startsWith('### ')) count += 1;
  }

  return count;
}

/**
 * The demo controller, read as text, for the two figures about it that the prose states.
 *
 * READING A SOURCE FILE IS NOT A SECOND COPY OF IT, which is the distinction that matters here.
 * Both figures were dropped to prose in an earlier round rather than generated, on the ground
 * that nothing enumerated them; both were wrong about that, and a figure dropped to avoid
 * generating it is the same class wearing a different coat.
 */
function demoHandlers(): readonly { readonly head: string; readonly body: string }[] {
  const lines = readFileSync(
    join(REPOSITORY_ROOT, 'examples', 'nest-minimal', 'src', 'orders.controller.ts'),
    'utf8',
  ).split('\n');

  const starts = [...lines.keys()].filter((at) =>
    /^\s{2}@(?:Get|Post|Put|Patch|Delete|Sse)\(/.test(lines[at] ?? ''),
  );
  if (starts.length === 0) throw new Error('no handler was found in the demo controller');

  return starts.map((start, index) => ({
    head: lines[start] ?? '',
    body: lines.slice(start, starts[index + 1] ?? lines.length).join('\n'),
  }));
}

/** The product's own lists, for the counts that are about the product rather than about a page. */
const PRODUCT_COUNTS: Readonly<Record<string, () => number>> = {
  'slot-names': () => SLOT_NAMES.length,
  'server-resolved-slots': () => SERVER_RESOLVED_SLOTS.length,
  // `none` IS IN `BUILD_TARGETS` AND IS NOT A HOST. It is the absence of a target, so a build
  // per hosting target is one fewer than the union, and the example builds exactly these.
  'hosting-targets': () => BUILD_TARGETS.filter((target) => target !== 'none').length,
  'direct-targets': () => DIRECT_TARGETS.length,
  'rewriting-targets': () => PROXY_CONFIG_TARGETS.length,
  'demo-create-responses': () => {
    const create = demoHandlers().find((handler) => /^\s{2}@Post\(\)/.test(handler.head));
    if (create === undefined) throw new Error('the demo controller has no create handler');
    return (create.body.match(/@Api\w*Response\(/g) ?? []).length;
  },
  'demo-unscoped-handlers': () =>
    demoHandlers().filter((handler) => !/@(?:Scopes|ApiScopes)\(/.test(handler.body)).length,
};

/** Everything a `count:` region can be about. */
function countOf(source: string, lines: readonly string[], after: number): number {
  const product = PRODUCT_COUNTS[source];
  if (product !== undefined) return product();

  if (source === 'table') return tableRows(lines, after);
  if (source === 'table-above') return tableRows(lines, after, true);
  if (source === 'fence') return fenceLines(lines, after);
  if (source === 'fence-above') return fenceLines(lines, after, true);
  if (source === 'list') return listItems(lines, after);
  if (source === 'sections') return sectionsHere(lines, after);

  throw new Error(`no counter is defined for "${source}"`);
}

/** A region as the file carries it. */
const REGION = /<!-- gen: ([^>]+?) -->([\s\S]*?)<!-- \/gen -->/g;

/**
 * Expands every generated region of one markdown file.
 *
 * @param markdown - The file as committed
 * @returns The file with every region rewritten from its source
 */
export function expandGenerated(markdown: string): string {
  // CLAIMS FIRST, THEN COUNTS, AND THAT ORDER IS THE WHOLE OF THIS FUNCTION'S SHAPE. A claim
  // region emits a whole fenced block, so expanding it moves every line below it; a count is
  // read by looking at the lines around its own position. Computed in one pass the counts were
  // read against the file as it was before the claims moved, so expanding twice gave two
  // answers and a checked-in file could never be stable.
  const withClaims = markdown.replace(REGION, (whole, rawSpec: string) => {
    const spec = parseSpec(rawSpec.trim());
    if (spec.kind !== 'claims') return whole;

    // THE FENCE IS EMITTED TOO, because a comment inside a fenced block is not a comment: it is
    // four characters of code a reader sees. So the region wraps the block rather than sitting
    // in it, and the generator owns the delimiters as well as the lines.
    const sentences = claimsFor(spec.context).map((claim) => claim.sentence);
    return `<!-- gen: ${rawSpec.trim()} -->\n\`\`\`\n${sentences.join('\n')}\n\`\`\`\n<!-- /gen -->`;
  });

  const lines = withClaims.split('\n');

  return withClaims.replace(REGION, (whole, rawSpec: string, body: string, offset: number) => {
    const spec = parseSpec(rawSpec.trim());
    if (spec.kind === 'claims') return whole;

    // A count is inline, so its spelling has to match the sentence it sits in: the body it
    // replaces says whether the number opens the sentence.
    const line = withClaims.slice(0, offset).split('\n').length - 1;
    const capital = /^[A-Z]/.test(body.trim());
    return `<!-- gen: ${rawSpec.trim()} -->${spell(countOf(spec.source, lines, line), capital)}<!-- /gen -->`;
  });
}

/**
 * Which regions each surface has to carry, by the spec the region names.
 *
 * WITHOUT THIS, DELETING A REGION IS GREEN. Two shapes were: removing a region's markers and
 * keeping its text, which turns generated prose into hand prose that never regenerates again;
 * and deleting a whole region from one surface, which the earlier checks missed because they
 * joined every surface into one string and asked whether the claim appeared anywhere. The
 * expectation is per surface and asserted both ways.
 *
 * KEYED BY REPOSITORY RELATIVE PATH, and `generated.spec.ts` also refuses a key naming a file
 * that does not exist, so this table cannot outlive the surface it describes.
 */
export const EXPECTED_REGIONS: Readonly<Record<string, readonly string[]>> = {
  'README.md': ['claims:bare-mount', 'claims:printed-block', 'count:fence-above'],
  'docs/guide/00-first-minute.md': [
    'claims:bare-mount',
    'claims:printed-block',
    'count:fence-above',
    'count:fence',
    'count:table',
  ],
  'docs/guide/01-coming-from-nestjs-swagger.md': [
    'claims:printed-block',
    'count:list',
    'count:fence',
  ],
  'docs/guide/02-the-two-forms.md': ['count:table'],
  'docs/guide/03-decorators.md': ['count:fence', 'count:list'],
  'docs/guide/04-collectors.md': ['count:list'],
  'docs/guide/05-themes.md': ['count:table', 'count:slot-names', 'count:server-resolved-slots'],
  'docs/guide/06-the-command-line.md': ['count:fence', 'count:list'],
  'docs/guide/09-security.md': ['count:sections'],
  'docs/guide/10-examples.md': ['count:table', 'count:list'],
  'examples/README.md': [
    'count:table',
    'count:demo-create-responses',
    'count:demo-unscoped-handlers',
  ],
  'examples/static-build/README.md': [
    'count:hosting-targets',
    'count:direct-targets',
    'count:rewriting-targets',
  ],
};

/**
 * Every figure the prose states that this file does not generate, and what each one lacks.
 *
 * A FIGURE DROPPED TO AVOID GENERATING IT IS THE SAME CLASS WEARING A DIFFERENT COAT, so the
 * ones that stay hand written are listed here rather than left as an absence a reader cannot
 * see. Each names the file it is in and the reason nothing enumerates it; `generated.spec.ts`
 * asserts every quoted phrase is still in its file, so this record cannot go stale by editing.
 */
export const UNGENERATED_FIGURES: readonly {
  readonly surface: string;
  readonly phrase: string;
  readonly lacks: string;
}[] = [
  {
    surface: 'README.md',
    phrase: 'so the last two cost more than a line',
    lacks: 'the two are named in the same sentence, so there is no list or table to count',
  },
  {
    surface: 'docs/guide/01-coming-from-nestjs-swagger.md',
    phrase: 'The other facts a `@nestjs/swagger` setup never had',
    lacks: 'the same self naming shape, with the figure already removed from the sentence',
  },
  {
    surface: 'docs/guide/02-the-two-forms.md',
    phrase: 'A short list at the root, and no more.',
    lacks: 'the members are keys of a TypeScript type, which nothing here parses',
  },
  {
    surface: 'docs/guide/02-the-two-forms.md',
    phrase: 'Three names from the specification',
    lacks: 'the three are named in the next clause, so the count is self naming',
  },
  {
    surface: 'docs/guide/02-the-two-forms.md',
    phrase: 'is why one of those two is a refusal you can see',
    lacks: 'refers to two things named in the paragraph rather than to a block',
  },
  {
    surface: 'docs/guide/04-collectors.md',
    phrase: 'The contract is public and frozen, and both members are in the block below',
    lacks: 'a fenced interface, whose lines are not its members',
  },
  {
    surface: 'docs/guide/09-security.md',
    phrase: 'Two packages in the wider',
    lacks:
      'derivable from the workspace, and left in prose because the claim suite reads it instead',
  },
  {
    surface: 'examples/README.md',
    phrase: 'Every one that listens is booted and',
    lacks: 'the subset that listens is a property of each example, which nothing enumerates',
  },
  {
    surface: 'examples/custom-theme/README.md',
    phrase: 'Tokens only. No bundle, no build step, no package.',
    lacks: 'the token count would need the theme file parsed, and the figure was removed instead',
  },
  {
    surface: 'examples/events/README.md',
    phrase: 'What it serves:',
    lacks: 'the table mixes mounts and one mount route, so its rows are not the figure',
  },
  {
    surface: 'docs/guide/10-examples.md',
    phrase: 'ones that listen are booted by a committed test',
    lacks: 'the same subset as the examples index, and unenumerable for the same reason',
  },
];

/** Every documentation surface the generator owns. */
export function generatedSurfaces(): readonly string[] {
  const guide = join(REPOSITORY_ROOT, 'docs', 'guide');

  return [
    join(REPOSITORY_ROOT, 'README.md'),
    join(REPOSITORY_ROOT, 'docs', 'README.md'),
    join(REPOSITORY_ROOT, 'examples', 'README.md'),
    ...readdirSync(guide)
      .filter((file) => file.endsWith('.md'))
      .sort()
      .map((file) => join(guide, file)),
    ...readdirSync(join(REPOSITORY_ROOT, 'examples'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(REPOSITORY_ROOT, 'examples', entry.name, 'README.md'))
      .filter((file) => {
        try {
          readFileSync(file);
          return true;
        } catch {
          return false;
        }
      }),
  ];
}

/**
 * Expands every surface in place.
 *
 * @returns The surfaces whose text moved, which is what a stale checkout reports
 */
export function writeGeneratedDocumentation(): readonly string[] {
  const moved: string[] = [];

  for (const file of generatedSurfaces()) {
    const before = readFileSync(file, 'utf8');
    const after = expandGenerated(before);
    if (after !== before) {
      writeFileSync(file, after);
      moved.push(file.slice(REPOSITORY_ROOT.length + 1));
    }
  }

  return moved;
}
