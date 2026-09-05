import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME_NAME, PACKAGE_NAME } from '../../src/index';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..');
const THEME_CSS = join(import.meta.dirname, '..', '..', 'src', 'styles', 'theme.css');
const RENDERER_SRC = join(REPO_ROOT, 'packages', 'render', 'src');

/**
 * Names the renderer's source mentions, which is a superset of the classes it emits.
 *
 * READ FROM DISK, NOT IMPORTED. STANDARDS 3.5 gives this package no upstream at all and the
 * graph linter enforces it, so the theme cannot import the renderer and must not. Reading a
 * sibling's source at test time creates no edge in the module graph; it is the same technique
 * `default-theme.spec.ts` already uses to prove this package imports nothing.
 *
 * The two lists have to agree in both directions and neither package can see the other, which
 * is exactly the situation where they drift. The renderer's own comment says its class names
 * come from the vocabulary this package declares. This is where that stops being a comment.
 */
function emittedNames(): Set<string> {
  const found = new Set<string>();

  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (!entry.endsWith('.ts')) continue;

      for (const match of readFileSync(path, 'utf8').matchAll(/oref-[a-z0-9-]+/g)) {
        found.add(match[0]);
      }
    }
  };

  walk(RENDERER_SRC);
  return found;
}

/** Class names the stylesheet styles. */
function styledClasses(): Set<string> {
  const css = readFileSync(THEME_CSS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  return new Set([...css.matchAll(/\.(oref-[a-z0-9-]+)/g)].map((match) => match[1] ?? ''));
}

/**
 * Names the renderer's source holds that are not classes.
 *
 * Written out rather than filtered by shape, because each one is a different kind of thing and
 * a shape rule would quietly absorb a class that went missing. An element id, the two data
 * attribute suffixes, the shiki theme name, and the two prefixes a class name is built from at
 * runtime, whose full names appear in the stylesheet.
 */
const NOT_CLASSES = new Set([
  'oref-app',
  'oref-state',
  'oref-main',
  'oref-document',
  'oref-node',
  'oref-lang',
  'oref-color-scheme',
  'oref-css-variables',
  // The two data attribute suffixes of the Web Component, per T033: the element's done signal
  // and the marker on a stylesheet link hoisted for the font registry. States, not classes.
  'oref-embedded',
  'oref-embed-fonts',
  'oref-method-',
  'oref-status-',
  'oref-hl-',
  // The provenance mark, whose level is a value: `oref-prov-${confidence}` is built from the
  // three of SPEC 6.1 and the full names are in the stylesheet.
  'oref-prov-',
  // Data attributes the reference UI reads back off an element: the chunk a list is, the depth
  // a navigation row sits at, the option the palette has selected, the schema a page shows, and
  // the position a schema row is. `oref-path` is not here, because it is also a class.
  'oref-chunk',
  'oref-level',
  'oref-option',
  'oref-schema',
  // The federation pair of T046: `data-oref-service` names the service an element is about, and
  // `data-oref-remote-status` is the live status the snapshot fetch writes onto it. States, not
  // classes; the stylesheet selects them as attributes.
  'oref-service',
  'oref-remote-status',
  // `data-oref-nav-scroller`, written onto whichever element the navigation found actually
  // scrolls. A state, not a class: the renderer reads the computed overflow rather than
  // assuming which element a stylesheet gave it to, and the attribute is how a browser suite
  // checks the binding instead of describing it.
  'oref-nav-scroller',
  // `data-oref-copy`, on the copy control of the call samples block. A state, not a class: the
  // button rides `.oref-send`, which this theme draws, and a class of its own would have put a
  // name on the second theme's boundary list for a rule that would style nothing new.
  'oref-copy',
  // Ids the palette generates one per option, so `aria-activedescendant` can name one.
  'oref-palette-option-',
  // Id prefix of a try-it field, so a label can name the control it belongs to. The full id
  // carries the node id and the parameter, so it is built at runtime and is never a class.
  'oref-field-',
  // Id prefix of a Health panel rule group, so a FixBar's code can link to it. The full id
  // carries the kebab rule id and is built at runtime, and it is never a class.
  'oref-rule-',
  // The parity scale's severity families, per TX-GUTTER: the verdict box, the FixBar and its
  // chip each build `-crit`, `-warn` or `-note` from the finding's severity at runtime. The
  // full names are in the stylesheet, the way `oref-prov-` already works.
  'oref-verdict-',
  'oref-fixbar-',
  'oref-sev-',
  // The shapes page's nesting steps, per TX-SHAPES: `oref-shape-d${depth}` is built from the
  // walk's depth at runtime, and d0 through d6 are in the stylesheet, the `oref-prov-` shape.
  'oref-shape-d',
]);

/**
 * Families whose members the renderer builds at runtime from a prefix.
 *
 * `oref-method-${method}`, `oref-status-${class}xx`, `oref-prov-${confidence}`, one syntax
 * class per shiki colour, and since TX-GUTTER the parity scale's three severity families,
 * `oref-verdict-`, `oref-fixbar-` and `oref-sev-`, each suffixed `crit`, `warn` or `note` from
 * the finding's severity. The full names are in the stylesheet and never in the renderer's
 * source, so they are matched by their prefix. The prefix itself is in the source, which is
 * what `NOT_CLASSES` covers.
 */
const GENERATED_PREFIXES = [
  'oref-method-',
  'oref-status-',
  'oref-hl-',
  'oref-prov-',
  'oref-verdict-',
  'oref-fixbar-',
  'oref-sev-',
  // The shapes page's nesting steps, per TX-SHAPES: seven full names in the stylesheet, the
  // depth suffix built at runtime.
  'oref-shape-d',
];

/**
 * Section modifiers the renderer emits beside `oref-section`, which this theme needs no rule
 * for.
 *
 * They exist so an L0 or L1 consumer can reach one section without reaching all of them, which
 * is the whole reason a modifier is emitted at all. vernier styles every section alike, so a
 * rule here would be a rule with nothing in it. They are listed one by one rather than matched
 * by prefix, so that a sixth section appearing has to be looked at rather than absorbed.
 */
const MODIFIERS_WITHOUT_RULES = new Set([
  'oref-section-parameters',
  'oref-section-request',
  'oref-section-responses',
  'oref-section-security',
  'oref-section-servers',
  // THE FOUR OF T030, AND WHAT MAKES THEM MEMBERS OF THIS SET RATHER THAN EXEMPTIONS FROM THE
  // RULE. Each sits on an element that already carries a styled class and is drawn by it:
  // `oref-stream` on `.oref-run-result`, `oref-stream-problem` on `.oref-run-error`,
  // `oref-stream-element` on `.oref-run-body`, and the two controls on `.oref-send`. A class on
  // an element with no other class would not belong here whatever it was called, which is why
  // the console emits none: the stream region is made of elements the theme already draws, and
  // these are hooks for a theme that wants to tell a stream from a single response.
  'oref-stream',
  'oref-stream-element',
  'oref-stream-problem',
  'oref-stream-start',
  'oref-stream-stop',
  // THE FOUR OF THE CALL SAMPLES BLOCK, and they are members of this set for the reason the five
  // above are: each sits on an element that already carries a styled class and is drawn by it.
  // The strip is `.oref-tryit-actions`, a tab is `.oref-send`, the sample is `.oref-example`,
  // which is what a highlighted block of code already is, and the section is `.oref-section`.
  // A block that invented four classes of its own would have needed four rules, and both theme
  // budgets are within a few hundred bytes of their caps.
  'oref-section-samples',
  'oref-sample',
  'oref-sample-tab',
  'oref-sample-tabs',
  // THE TWO OF TX-MARKUP, members by the same rule. The error contracts section sits on
  // `.oref-section`, which draws it; the rail's event badge sits on `.oref-badge`, whose base
  // rule already paints the event colour, so a rule repeating the default would say nothing.
  'oref-section-errors',
  'oref-method-event',
  // THE ONE OF TX-PARITY-UI, a member by the same rule: the description section sits on
  // `.oref-section`, which draws it, and its prose already carries `.oref-description`.
  'oref-section-description',
  // THE ONE OF T046, a member by the same rule: the service card's kicker sits on
  // `.oref-section-title`, which draws it. The facts section is not here, because the facts
  // grid is its own rule.
  'oref-service-kicker',
  // THE EIGHT OF T050, THE CHANNEL PAGE, and every one is a member by the rule above rather than
  // an exemption from it. The three section modifiers sit on `.oref-section`, which draws them,
  // exactly as the five above do. The three media modifiers say which of a binding, a message
  // body and a declared example a block is, and each sits on `.oref-media`, which draws it: the
  // three share one family because each of them is a head naming a thing with a block of source
  // under it, which is what that family already is. The two direction modifiers sit on
  // `.oref-badge`, whose base rule paints them, and the direction is a word before it is a
  // colour, per SPEC 11's three signals rule read for a badge with one job: `send` and `receive`
  // are printed, so the distinction survives monochrome print and a theme with no rule here.
  'oref-section-channel',
  'oref-section-channel-operations',
  'oref-section-messages',
  'oref-media-binding',
  'oref-media-body',
  'oref-media-example',
  'oref-direction-send',
  'oref-direction-receive',
  // THE THREE OF `TX-SOCKET-CONSOLE`, THE SOCKET CONSOLE OF SPEC 14.7, and every one is a member
  // by the rule above rather than an exemption from it. The section modifier sits on
  // `.oref-section`, which draws it, exactly as the eight channel ones do. The log sits on
  // `.oref-run-result`, which is what a list of bodies a run produced already is, and one entry
  // sits on `.oref-run-body`, which draws it; the pair are the stream log's two names applied to
  // a window of frames, and they are hooks for a theme that wants to tell a socket window from a
  // single response rather than rules repeating what the family already says. The console emits
  // no other name of its own: its controls are `.oref-send`, its fields are the `.oref-field`
  // family, its counters are `.oref-facts`, its notice is `.oref-tryit-notice` and its direction
  // marks are `.oref-badge` with the two channel modifiers already listed above. That is what
  // makes this arrival cost the default stylesheet nothing at all, which SPEC 20 records with
  // the measurement rather than with a claim.
  'oref-section-socket',
  'oref-socket-log',
  'oref-socket-entry',
  // THE ONE OF T052, THE TOPOLOGY SECTION, a member by the rule above rather than an exemption
  // from it: the section modifier sits on `.oref-section`, which draws it, exactly as the eight
  // above do. Every other name the section emits has a rule, and five of the six are selectors
  // added to families this file already had, because a graph row is the runtime block's row, a
  // group is a channel operation and an indented list is a reply block.
  'oref-section-topology',
]);

/** The syntax token classes are generated one per shiki colour, so they are checked as a group. */
const HIGHLIGHT_PREFIX = 'oref-hl-';

describe('@openref/theme package shell', () => {
  it('should expose its own package name', () => {
    // Given
    const expected = '@openref/theme';

    // When
    const actual = PACKAGE_NAME;

    // Then
    expect(actual).toBe(expected);
  });

  it('should ship the design under the design own name', () => {
    // Given, the package is the default theme; which design that is happens to be a value.
    const expected = 'vernier';

    // When
    const actual = DEFAULT_THEME_NAME;

    // Then
    expect(actual).toBe(expected);
  });
});

describe('the stylesheet and the markup', () => {
  it('should style no class the renderer does not emit', () => {
    // Given, a rule for markup nobody renders is bytes every reader downloads for nothing, and
    // it reads as coverage while covering nothing.
    const emitted = emittedNames();

    // When
    const orphaned = [...styledClasses()]
      .filter((name) => !GENERATED_PREFIXES.some((prefix) => name.startsWith(prefix)))
      .filter((name) => !emitted.has(name))
      .sort();

    // Then
    expect(orphaned).toEqual([]);
  });

  it('should style every class the renderer emits', () => {
    // Given, the other direction: markup with no rule is markup the theme forgot.
    const styled = styledClasses();

    // When
    const unstyled = [...emittedNames()]
      .filter((name) => !NOT_CLASSES.has(name))
      .filter((name) => !MODIFIERS_WITHOUT_RULES.has(name))
      .filter((name) => !styled.has(name))
      .sort();

    // Then
    expect(unstyled).toEqual([]);
  });

  it('should reserve exactly the chunk the renderer windows the sidebar by', () => {
    // Given, the one number this stylesheet and the renderer have to agree on. An unrendered
    // chunk reserves a height, and the height is a count of rows: if the two disagree the
    // scrollbar is the wrong length and the rows jump as the window moves. Neither package can
    // import the other, so the constant is read out of the renderer's source, the way the class
    // lists above are.
    const source = readFileSync(join(RENDERER_SRC, 'page', 'domain', 'nav-rows.ts'), 'utf8');
    const declared = /NAV_CHUNK_ROWS = (\d+)/.exec(source)?.[1] ?? '';

    // When
    const reserved = /min-height:\s*calc\((\d+) \* var\(--oref-layout-nav-row\)\)/.exec(
      readFileSync(THEME_CSS, 'utf8'),
    )?.[1];

    // Then
    expect(declared).not.toBe('');
    expect(reserved).toBe(declared);
  });

  it('should style the syntax token classes, which are generated rather than written', () => {
    // Given, those names come from a shiki theme, so the renderer holds the prefix only.
    const styled = [...styledClasses()].filter((name) => name.startsWith(HIGHLIGHT_PREFIX));

    // When
    const emitsHighlightClasses = [...emittedNames()].some((name) =>
      name.startsWith(HIGHLIGHT_PREFIX),
    );

    // Then
    expect(emitsHighlightClasses).toBe(true);
    expect(styled.length).toBeGreaterThan(5);
  });
});
