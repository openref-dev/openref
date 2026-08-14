import type { Component } from 'vue';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { defineTheme, resolveSlots, resolveTheme } from '../../src/index';
import type {
  ResolvedTheme,
  SlotName,
  SlotRegistry,
  ThemeAssets,
  ThemeDefinition,
  ThemeTokens,
} from '../../src/index';

/**
 * The theme contract is public API, per SPEC 10.4 and CLAUDE.md rule 10.
 *
 * THIS FILE IS THE PIN, beside `slot-contract.spec.ts` for the props and
 * `packages/nest/test/unit/collector-contract.spec.ts` for the collector interface. Those three
 * are the whole of what T031 froze. `pnpm lint` typechecks the test tree, so a member added to,
 * removed from or retyped on any of them fails to compile rather than breaking every theme built
 * against it at some later date.
 *
 * WHAT A PIN OVER A CONTRACT IS FOR, WHICH IS NOT THE SAME AS A TEST OVER BEHAVIOUR. A theme is
 * written in a package this repository does not build, against a copy of these declarations that
 * may be a version behind. Nothing in this repository fails when that author's theme stops
 * compiling; the only place the change can be caught is here, at the moment it is made.
 */

describe('the theme definition', () => {
  it('should be exactly the five members SPEC 10.4 names', () => {
    // Given
    type Members = keyof ThemeDefinition;

    // Then, growing this is a minor version and only if every member added is optional; making
    // one required, removing one, or renaming one is a major version for every published theme
    expectTypeOf<Members>().toEqualTypeOf<'name' | 'layout' | 'components' | 'tokens' | 'assets'>();
  });

  it('should require a name and leave the other four optional', () => {
    // Given, an L0 theme is tokens alone and an L1 theme is one component. Requiring `components`
    // would make the smallest useful theme impossible to write.

    // Then
    expectTypeOf<ThemeDefinition['name']>().toEqualTypeOf<string>();
    expectTypeOf<{ name: 'aurora' }>().toExtend<ThemeDefinition>();
    expectTypeOf<{ tokens: ThemeTokens }>().not.toExtend<ThemeDefinition>();
  });

  it('should type the layout as a loader and never as a component', () => {
    // Given, `layout: () => import('./Layout')` is the authoring form, and it is a loader so
    // that an unused theme costs nothing: the module arrives when the position first renders.

    // Then
    expectTypeOf<ThemeDefinition['layout']>().toEqualTypeOf<(() => Promise<unknown>) | undefined>();
  });

  it('should key tokens by string and value them by plain CSS', () => {
    // Given, a token whose value had to be computed would end up in an inline style, and a CSP
    // nonce cannot authorize one. The type is what keeps the value plain.

    // Then
    expectTypeOf<ThemeTokens>().toEqualTypeOf<Readonly<Record<string, string>>>();
    expectTypeOf<ThemeAssets>().toEqualTypeOf<{ readonly css?: readonly string[] }>();
  });

  it('should hand back exactly what it was given, so a theme runs nothing at import time', () => {
    // Given
    const definition = { name: 'aurora' };

    // Then, the identity is the contract: the server renderer, the static build and the browser
    // all read the same value and none of them executes it
    expectTypeOf(defineTheme).parameters.toEqualTypeOf<[ThemeDefinition]>();
    expectTypeOf(defineTheme).returns.toEqualTypeOf<ThemeDefinition>();
    expect(defineTheme(definition)).toBe(definition);
  });
});

describe('the resolved theme', () => {
  it('should be exactly the four members the state holds', () => {
    // Given
    type Members = keyof ResolvedTheme;

    // Then, `layout` is deliberately absent: it resolves into the `AppShell` slot, so one
    // position has one lookup and a renderer that resolves slots resolves the shell for free
    expectTypeOf<Members>().toEqualTypeOf<'name' | 'slots' | 'tokens' | 'assets'>();
    expectTypeOf<ResolvedTheme['slots']>().toEqualTypeOf<SlotRegistry>();
  });

  it('should be what resolveTheme returns and what resolveSlots returns half of', () => {
    // Given, the split exists because the browser needs the registry and not the validation:
    // a theme is refused where it is authored and on the server, and a refusal is not bytes a
    // reader downloads.

    // Then
    expectTypeOf(resolveTheme).parameters.toEqualTypeOf<[ThemeDefinition?]>();
    expectTypeOf(resolveTheme).returns.toEqualTypeOf<ResolvedTheme>();
    expectTypeOf(resolveSlots).parameters.toEqualTypeOf<[ThemeDefinition | undefined]>();
    expectTypeOf(resolveSlots).returns.toEqualTypeOf<SlotRegistry>();
  });
});

describe('the slot registry', () => {
  it('should be exactly the four members a theme and a renderer use', () => {
    // Given
    type Members = keyof SlotRegistry;

    // Then
    expectTypeOf<Members>().toEqualTypeOf<'has' | 'resolve' | 'register' | 'overridden'>();
  });

  it('should take a string and narrow it, because a theme is external input', () => {
    // Given a theme built against a different major version, whose component map may name
    // anything at all. The runtime check and the type level narrowing are one call.

    // Then
    expectTypeOf<SlotRegistry['has']>().guards.toEqualTypeOf<SlotName>();
    expectTypeOf<SlotRegistry['resolve']>().parameters.toEqualTypeOf<[string]>();
    expectTypeOf<SlotRegistry['resolve']>().returns.toEqualTypeOf<Component | undefined>();
    expectTypeOf<SlotRegistry['overridden']>().returns.toEqualTypeOf<readonly SlotName[]>();
  });

  it('should refuse a component in a name that is not a slot, at runtime and not only in types', () => {
    // Given, this is the half a type cannot carry: the theme was compiled somewhere else.
    const registry = resolveSlots(defineTheme({ name: 'aurora' }));

    // When
    const refuse = (): void => {
      registry.register('NotASlot', {} as Component);
    };

    // Then
    expect(refuse).toThrow(/there is no slot named "NotASlot"/);
  });
});
