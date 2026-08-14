import { ThemeContractError } from '@openref/core';
import { SLOT_NAMES, defineTheme, type ThemeDefinition } from '@openref/vue';
import { defineComponent, h, type VNode } from 'vue';
import { describe, expect, it } from 'vitest';
import { assertTheme, checkTheme, scaffoldTheme } from '../../src/index';

/**
 * The conformance checker, per SPEC 10.4 and BUILD T031.
 *
 * The contract is frozen from this task on, which means an author's mistake has to be met by a
 * sentence naming what is wrong rather than by a blank region in a browser. These cases assert
 * the sentence, not just the rejection: a checker that refused correctly with a message nobody
 * can act on would pass a test that only looked at whether it threw.
 */

const stub = defineComponent({
  name: 'Stub',
  setup() {
    return (): VNode => h('div');
  },
});

/**
 * A theme that fills every slot, built from the registry so it cannot fall out of step.
 *
 * THE SHELL COMES THROUGH `layout` AND NOT THROUGH `components.AppShell`, which is the shape
 * `scaffoldTheme` writes and the only one `resolveTheme` accepts: one position, one mechanism.
 */
function completeTheme(): ThemeDefinition {
  return defineTheme({
    name: 'aurora',
    layout: () => Promise.resolve(stub),
    components: Object.fromEntries(
      SLOT_NAMES.filter((slot) => slot !== 'AppShell').map((slot) => [slot, stub]),
    ),
  });
}

describe('checkTheme at L2', () => {
  it('should accept a theme that fills every slot and brings a layout', () => {
    // Given
    const theme = completeTheme();

    // When
    const report = checkTheme(theme, { level: 'L2' });

    // Then
    expect(report.conforms).toBe(true);
    expect(report.missingSlots).toEqual([]);
    expect(report.problems).toEqual([]);
  });

  it('should name the slot a theme did not fill', () => {
    // Given
    const complete = completeTheme();
    const { StreamLog: _dropped, ...rest } = complete.components ?? {};
    const theme = defineTheme({ ...complete, components: rest });

    // When
    const report = checkTheme(theme, { level: 'L2' });

    // Then
    expect(report.conforms).toBe(false);
    expect(report.missingSlots).toEqual(['StreamLog']);
    expect(report.problems[0]?.message).toContain('"StreamLog"');
  });

  it('should name every missing slot in registry order rather than stopping at the first', () => {
    // Given, a theme with a shell and nothing else, so `AppShell` is the one name not missing.
    const theme = defineTheme({ name: 'aurora', layout: () => Promise.resolve(stub) });

    // When
    const report = checkTheme(theme, { level: 'L2' });

    // Then
    expect(report.missingSlots).toEqual(SLOT_NAMES.filter((slot) => slot !== 'AppShell'));
  });

  it('should refuse a theme with no shell and offer both ways of writing one', () => {
    // Given, a theme with every slot but the shell, which is one position under two names.
    const { layout: _none, ...rest } = completeTheme();
    const theme = defineTheme(rest);

    // When
    const report = checkTheme(theme, { level: 'L2' });

    // Then
    expect(report.problems.map((problem) => problem.kind)).toEqual(['missing-slot']);
    expect(report.missingSlots).toEqual(['AppShell']);
    expect(report.problems[0]?.message).toContain('layout');
    expect(report.problems[0]?.message).toContain('components.AppShell');
  });

  it('should refuse a theme that declares its shell twice, the way the loader does', () => {
    // Given, `resolveTheme` throws on this, so a checker that passed it would send an author to
    // meet the refusal at load time instead of at the check they were told to run.
    const complete = completeTheme();
    const theme = defineTheme({
      ...complete,
      components: { ...complete.components, AppShell: stub },
    });

    // When
    const report = checkTheme(theme, { level: 'L2' });

    // Then
    expect(report.problems.map((problem) => problem.kind)).toEqual(['duplicate-shell']);
    expect(report.problems[0]?.message).toContain('twice');
  });
});

describe('checkTheme at L1', () => {
  it('should accept a theme that fills one slot and leaves the rest to the reference', () => {
    // Given
    const theme = defineTheme({ name: 'aurora', components: { StateNotice: stub } });

    // When
    const report = checkTheme(theme, { level: 'L1' });

    // Then
    expect(report.conforms).toBe(true);
    expect(report.missingSlots).toEqual([]);
  });

  it('should still refuse a name that is not a slot, because nothing would ever render it', () => {
    // Given
    const theme = defineTheme({ name: 'aurora', components: { OperationFooter: stub } });

    // When
    const report = checkTheme(theme, { level: 'L1' });

    // Then
    expect(report.conforms).toBe(false);
    expect(report.unknownSlots).toEqual(['OperationFooter']);
    expect(report.problems[0]?.message).toContain('"OperationFooter" is not a slot');
    expect(report.problems[0]?.message).toContain('21');
  });

  it('should refuse a token that is outside the --oref- namespace', () => {
    // Given
    const theme = defineTheme({ name: 'aurora', tokens: { '--brand-blue': '#00f' } });

    // When
    const report = checkTheme(theme, { level: 'L1' });

    // Then
    expect(report.problems.map((problem) => problem.subject)).toEqual(['--brand-blue']);
  });

  it('should refuse a name that cannot be a package name', () => {
    // Given
    const theme = defineTheme({ name: 'Aurora Theme' });

    // When
    const report = checkTheme(theme, { level: 'L1' });

    // Then
    expect(report.problems[0]?.kind).toBe('invalid-name');
  });
});

describe('assertTheme', () => {
  it('should return the report when the theme conforms', () => {
    // Given
    const theme = completeTheme();

    // When
    const report = assertTheme(theme, { level: 'L2' });

    // Then
    expect(report.conforms).toBe(true);
  });

  it('should refuse with a message naming the missing slot, not with a diff', () => {
    // Given
    const complete = completeTheme();
    const { AuthPanel: _dropped, ...rest } = complete.components ?? {};
    const theme = defineTheme({ ...complete, components: rest });

    // When
    const refuse = (): unknown => assertTheme(theme, { level: 'L2' });

    // Then
    expect(refuse).toThrow(ThemeContractError);
    expect(refuse).toThrow(/AuthPanel/);
  });

  it('should carry the slots in the error context, so a tool need not parse the sentence', () => {
    // Given
    const theme = defineTheme({ name: 'aurora', components: { Nonsense: stub } });

    // When
    let caught: ThemeContractError | undefined;
    try {
      assertTheme(theme, { level: 'L1' });
    } catch (error) {
      caught = error instanceof ThemeContractError ? error : undefined;
    }

    // Then
    expect(caught?.context).toMatchObject({ theme: 'aurora', unknownSlots: ['Nonsense'] });
  });
});

describe('the scaffold and the checker together', () => {
  it('should produce an L2 theme that satisfies the L2 contract', async () => {
    // Given, the shell is `Layout.ts` and is named through `layout`, so there is no `AppShell`
    // component file and the generated theme is one `resolveTheme` accepts.
    const files = scaffoldTheme({ name: 'aurora', level: 'L2' });
    const drawn = SLOT_NAMES.filter((slot) => slot !== 'AppShell');
    const components = Object.fromEntries(drawn.map((slot) => [slot, stub]));

    // When, the generated theme file names exactly the slots it imports
    const themeSource = files.find((file) => file.path === 'src/theme.ts')?.contents ?? '';
    const report = checkTheme(
      defineTheme({ name: 'aurora', layout: () => Promise.resolve(stub), components }),
      { level: 'L2' },
    );

    // Then
    expect(report.conforms).toBe(true);
    for (const slot of drawn) {
      expect(themeSource).toContain(`import ${slot} from './components/${slot}';`);
      expect(files.some((file) => file.path === `src/components/${slot}.ts`)).toBe(true);
    }
    expect(files.some((file) => file.path === 'src/components/AppShell.ts')).toBe(false);
    expect(themeSource).toContain("layout: () => import('./Layout')");
    await Promise.resolve();
  });

  it('should generate an L1 theme that names only the slot it fills', () => {
    // Given, When
    const files = scaffoldTheme({ name: 'aurora', level: 'L1' });

    // Then
    const paths = files.map((file) => file.path);
    expect(paths).toContain('src/components/StateNotice.ts');
    expect(paths.filter((path) => path.startsWith('src/components/'))).toHaveLength(1);
    expect(paths).not.toContain('src/Layout.ts');
  });

  it('should refuse to scaffold a theme with no name', () => {
    // Given, When
    const scaffold = (): unknown => scaffoldTheme({ name: '', level: 'L1' });

    // Then
    expect(scaffold).toThrow(RangeError);
  });
});
