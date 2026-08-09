import { ErrorCode, SlotNotFoundError, ThemeContractError } from '@openref/core';
import { defineComponent, h } from 'vue';
import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME_NAME, defineTheme, resolveTheme } from '../../src/index';

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
    expect(theme.name).toBe(DEFAULT_THEME_NAME);
    expect(theme.tokens).toEqual({});
    expect(theme.assets).toEqual({});
    expect(theme.slots.overridden()).toEqual([]);
  });

  it('should carry the layout, tokens and assets a theme declared', () => {
    // Given
    const layout = (): Promise<unknown> => Promise.resolve({});
    const definition = defineTheme({
      name: 'aurora',
      layout,
      components: { layout: Stub },
      tokens: { '--oref-color-accent': '#7c5cff', '--oref-space-2': '8px' },
      assets: { css: ['./aurora.css'] },
    });

    // When
    const theme = resolveTheme(definition);

    // Then
    expect(theme.name).toBe('aurora');
    expect(theme.layout).toBe(layout);
    expect(theme.assets.css).toEqual(['./aurora.css']);
    expect(theme.slots.resolve('layout')).toBe(Stub);
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
    const definition = { name: 'aurora', tokens: { '--oref-space-1': 4 } as unknown } as Parameters<
      typeof resolveTheme
    >[0];

    // When
    const resolve = (): unknown => resolveTheme(definition);

    // Then
    expect(resolve).toThrow(ThemeContractError);
  });

  it('should refuse a theme that overrides something which is not a slot', () => {
    // Given
    const definition = defineTheme({ name: 'aurora', components: { sidebar_item: Stub } });

    // When
    const resolve = (): unknown => resolveTheme(definition);

    // Then
    expect(resolve).toThrow(SlotNotFoundError);
  });

  it('should give each resolution its own slot registry', () => {
    // Given
    const first = resolveTheme(defineTheme({ name: 'a', components: { footer: Stub } }));

    // When
    const second = resolveTheme(defineTheme({ name: 'b' }));

    // Then
    expect(first.slots.resolve('footer')).toBe(Stub);
    expect(second.slots.resolve('footer')).toBeUndefined();
  });
});
