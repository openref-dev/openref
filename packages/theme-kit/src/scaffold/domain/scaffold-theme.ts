import { SLOT_NAMES, type SlotName } from '@openref/vue';
import type { ThemeLevel } from '../../conformance/domain/check-theme';

/**
 * Scaffolding a theme package, per BUILD T031.
 *
 * IT RETURNS FILES RATHER THAN WRITING THEM. A generator that writes to disk can only be tested
 * by writing to disk, and what has to be tested is the content: that what comes out of here
 * satisfies the contract the same code refuses a theme for missing. So this produces the file
 * list as data, `theme-kit`'s command writes it, and the test runs the conformance checker over
 * the result rather than over a fixture somebody kept in step by hand.
 *
 * THE COMPONENTS ARE `.ts` AND NOT `.vue`, which is a deviation from the naming table in
 * STANDARDS and is the same choice the reference itself made. A single file component needs a
 * compiler in the author's build before anything can run, including the conformance check; a
 * component written with `defineComponent` and `h` runs under plain TypeScript. An author who
 * wants single file components changes the extension and adds the plugin, and nothing in the
 * contract moves.
 *
 * AN L2 SCAFFOLD FILLS EVERY SLOT OF THE REGISTRY WITH A VISIBLE STUB. An empty stub would render nothing and
 * the author would meet their first missing slot as a blank region in a browser. Each stub
 * prints its own slot name, so the first run of the harness is a page that says what every
 * region is.
 */

/** One generated file. */
export interface ScaffoldFile {
  /** Path relative to the theme package root, using forward slashes. */
  readonly path: string;
  readonly contents: string;
}

/** What to generate. */
export interface ScaffoldOptions {
  /** Theme name, lowercase words joined by hyphens. Becomes the package name. */
  readonly name: string;
  /** The level the theme is being written at, per SPEC 10.1. */
  readonly level: ThemeLevel;
}

/**
 * Positions that are handed their content as children rather than as data.
 *
 * A STUB THAT IGNORES ITS CHILDREN DRAWS AN EMPTY PAGE, and the author meets that as a blank
 * region on their first run rather than as a message. The overview is handed the Health panel and
 * the schema page is handed its tree, so both stubs render what they were given under their own
 * heading.
 */
const SLOTS_WITH_CHILDREN = new Set<SlotName>(['DocumentOverview', 'SchemaPage']);

function stubComponent(slot: SlotName, name: string): string {
  const body = SLOTS_WITH_CHILDREN.has(slot)
    ? `h('div', { class: 'oref-${name}-${slot.toLowerCase()}' }, ['${slot}', ...(slots.default?.() ?? [])])`
    : `h('div', { class: 'oref-${name}-${slot.toLowerCase()}' }, '${slot}')`;
  const setup = SLOTS_WITH_CHILDREN.has(slot) ? 'setup(_props, { slots })' : 'setup()';

  return `import { defineComponent, h, type VNode } from 'vue';

/** The \`${slot}\` slot of the ${name} theme. Replace this with your own markup. */
export default defineComponent({
  name: '${name}${slot}',
  ${setup} {
    return (): VNode => ${body};
  },
});
`;
}

/**
 * Slots the scaffold writes a component file for.
 *
 * `AppShell` IS NOT ONE OF THEM, AND THAT IS THE ONE POSITION RULE MADE VISIBLE. The generated
 * theme writes its shell as `Layout.ts` and names it through `layout`, which is the authoring
 * surface; `resolveTheme` turns that into the `AppShell` slot and refuses a theme that declares
 * the position twice. A scaffold that wrote both would generate a theme the loader refuses.
 */
const SCAFFOLDED_SLOTS = SLOT_NAMES.filter((slot) => slot !== 'AppShell');

function themeFile(options: ScaffoldOptions): string {
  const imports = SCAFFOLDED_SLOTS.map(
    (slot) => `import ${slot} from './components/${slot}';`,
  ).join('\n');
  const entries = SCAFFOLDED_SLOTS.map((slot) => `    ${slot},`).join('\n');

  if (options.level === 'L1') {
    return `import { defineTheme } from '@openref/vue';
import StateNotice from './components/StateNotice';

/**
 * The ${options.name} theme, level L1.
 *
 * An L1 theme replaces the slots it names and lets every other one fall through to the
 * reference. Add a slot by putting a component in \`components\` under its registry name.
 */
export default defineTheme({
  name: '${options.name}',
  components: { StateNotice },
  tokens: {
    '--oref-color-accent': '#3b6ef5',
  },
  assets: { css: ['./${options.name}.css'] },
});
`;
  }

  return `import { defineTheme } from '@openref/vue';
${imports}

/**
 * The ${options.name} theme, level L2.
 *
 * An L2 theme carries its own layout and fills every slot, because the reference ships no
 * markup of its own to fall back to. \`assertTheme\` refuses it by name if one is missing.
 */
export default defineTheme({
  name: '${options.name}',
  layout: () => import('./Layout'),
  components: {
${entries}
  },
  tokens: {
    '--oref-color-accent': '#3b6ef5',
  },
  assets: { css: ['./${options.name}.css'] },
});
`;
}

/**
 * Generates a theme package.
 *
 * @param options - Name and level of the theme
 * @returns Every file of the package, as data
 * @throws {RangeError} When the name is empty, because a package cannot be unnamed
 *
 * @example
 * const files = scaffoldTheme({ name: 'aurora', level: 'L2' });
 * files.map((file) => file.path); // ['package.json', 'src/theme.ts', ...]
 */
export function scaffoldTheme(options: ScaffoldOptions): readonly ScaffoldFile[] {
  if (options.name.length === 0) throw new RangeError('a theme package needs a name');

  const files: ScaffoldFile[] = [
    {
      path: 'package.json',
      contents: `${JSON.stringify(
        {
          name: `@openref/theme-${options.name}`,
          version: '0.0.0',
          description: `The ${options.name} theme for OPENREF`,
          type: 'module',
          main: './dist/index.js',
          types: './dist/index.d.ts',
          files: ['dist', `${options.name}.css`],
          peerDependencies: { '@openref/vue': '*', vue: '^3.5.0' },
        },
        null,
        2,
      )}\n`,
    },
    { path: 'src/theme.ts', contents: themeFile(options) },
    {
      path: `src/${options.name}.css`,
      contents: `/* The ${options.name} theme reads tokens and never hardcodes a value. */\n.oref-${options.name} {\n  color: var(--oref-color-fg);\n  background: var(--oref-color-bg);\n}\n`,
    },
    {
      path: 'README.md',
      contents: `# @openref/theme-${options.name}\n\nA level ${options.level} theme for OPENREF.\n\nRun the contract check before publishing:\n\n\`\`\`ts\nimport { assertTheme } from '@openref/theme-kit';\nimport theme from './src/theme';\n\nassertTheme(theme, { level: '${options.level}' });\n\`\`\`\n`,
    },
  ];

  if (options.level === 'L2') {
    files.push({
      path: 'src/Layout.ts',
      contents: `import { defineComponent, h, type VNode } from 'vue';

/**
 * The page shell of the ${options.name} theme, which is the \`AppShell\` position.
 *
 * Three regions arrive as slots: \`nav\` is the navigation tree, \`palette\` is the search overlay,
 * and the default slot is the page. Where they go is the whole of what a layout decides.
 */
export default defineComponent({
  name: '${options.name}Layout',
  setup(_props, { slots }) {
    return (): VNode =>
      h('div', { class: 'oref-${options.name}' }, [
        ...(slots.nav?.() ?? []),
        ...(slots.palette?.() ?? []),
        ...(slots.default?.() ?? []),
      ]);
  },
});
`,
    });
    for (const slot of SCAFFOLDED_SLOTS)
      files.push({
        path: `src/components/${slot}.ts`,
        contents: stubComponent(slot, options.name),
      });
  } else {
    files.push({
      path: 'src/components/StateNotice.ts',
      contents: stubComponent('StateNotice', options.name),
    });
  }

  return files;
}
