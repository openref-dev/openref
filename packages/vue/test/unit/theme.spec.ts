import { ErrorCode, SlotNotFoundError, ThemeContractError } from '@openref/core';
import { defineComponent, h } from 'vue';
import { describe, expect, it } from 'vitest';
import { FALLBACK_THEME_NAME, defineTheme, resolveTheme } from '../../src/index';

const Stub = defineComponent({ name: 'Stub', setup: () => () => h('span') });

describe('defineTheme', () => {
  it('should hand back the definition unchanged, running nothing at import time', () => {
    // Given
    const definition = { name: 'aurora', tokens: { '--oref-color-fg': '#fff' } };

    // When
    const theme = defineTheme(definition);

    // Then
    expect(theme).toBe(definition);
  });
});

describe('resolveTheme', () => {
  it('should resolve the default theme when nothing is supplied', () => {
    // Given, no theme at all.

    // When
    const theme = resolveTheme();

    // Then
    expect(theme.name).toBe(FALLBACK_THEME_NAME);
    expect(theme.tokens).toEqual({});
    expect(theme.assets).toEqual({});
    expect(theme.slots.overridden()).toEqual([]);
  });

  it('should carry the components, tokens and assets a theme declared', () => {
    // Given
    const definition = defineTheme({
      name: 'aurora',
      components: { AppShell: Stub },
      tokens: { '--oref-color-accent-spec': '#7c5cff', '--oref-space-400': '10px' },
      assets: { css: ['./aurora.css'] },
    });

    // When
    const theme = resolveTheme(definition);

    // Then
    expect(theme.name).toBe('aurora');
    expect(theme.assets.css).toEqual(['./aurora.css']);
    expect(theme.slots.resolve('AppShell')).toBe(Stub);
  });

  it('should resolve the layout into the AppShell slot rather than beside it', () => {
    // Given, `layout` is the authoring surface and `AppShell` is the position, and until
    // `TX-SLOTWIRE` they were two mechanisms for one place: the checker checked one and the
    // renderer would have had to decide between them.
    const definition = defineTheme({
      name: 'aurora',
      layout: () => Promise.resolve({ default: Stub }),
    });

    // When
    const theme = resolveTheme(definition);

    // Then
    expect(theme.slots.overridden()).toEqual(['AppShell']);
    expect(theme.slots.resolve('AppShell')).not.toBeUndefined();
  });

  it('should refuse a theme that declares its shell twice', () => {
    // Given, one position and two ways to fill it is the defect this whole task is about, so it
    // is refused by name rather than resolved by precedence.
    const definition = defineTheme({
      name: 'aurora',
      layout: () => Promise.resolve({ default: Stub }),
      components: { AppShell: Stub },
    });

    // When
    let thrown: unknown;
    try {
      resolveTheme(definition);
    } catch (error: unknown) {
      thrown = error;
    }

    // Then
    expect(thrown).toBeInstanceOf(ThemeContractError);
    expect((thrown as ThemeContractError).message).toContain('twice');
    expect((thrown as ThemeContractError).message).toContain('AppShell');
  });

  it('should refuse a theme with no name', () => {
    // Given
    const definition = { name: '   ' };

    // When
    let thrown: unknown;
    try {
      resolveTheme(definition);
    } catch (error: unknown) {
      thrown = error;
    }

    // Then
    expect(thrown).toBeInstanceOf(ThemeContractError);
    expect((thrown as ThemeContractError).code).toBe(ErrorCode.THEME_CONTRACT_VIOLATED);
  });

  it('should refuse a token that is not of the --oref-{group}-{name} form', () => {
    // Given
    const definition = defineTheme({ name: 'aurora', tokens: { '--brand-color': 'red' } });

    // When
    const resolve = (): unknown => resolveTheme(definition);

    // Then
    expect(resolve).toThrow(ThemeContractError);
  });

  it('should refuse a token whose value is not a string', () => {
    // Given, a theme is external input and can be built against another major version.
    const definition = {
      name: 'aurora',
      tokens: { '--oref-space-200': 4 } as unknown,
    } as Parameters<typeof resolveTheme>[0];

    // When
    const resolve = (): unknown => resolveTheme(definition);

    // Then
    expect(resolve).toThrow(ThemeContractError);
  });

  it('should refuse a theme that overrides something which is not a slot', () => {
    // Given
    const definition = defineTheme({ name: 'aurora', components: { NavTree_item: Stub } });

    // When
    const resolve = (): unknown => resolveTheme(definition);

    // Then
    expect(resolve).toThrow(SlotNotFoundError);
  });

  it('should give each resolution its own slot registry', () => {
    // Given
    const first = resolveTheme(defineTheme({ name: 'a', components: { StateNotice: Stub } }));

    // When
    const second = resolveTheme(defineTheme({ name: 'b' }));

    // Then
    expect(first.slots.resolve('StateNotice')).toBe(Stub);
    expect(second.slots.resolve('StateNotice')).toBeUndefined();
  });
});
