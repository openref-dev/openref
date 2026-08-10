import { describe, expect, it } from 'vitest';
import {
  auditMotionTokens,
  MOTION_DURATIONS,
  MOTION_TOKENS,
  readBlocks,
  resolveToken,
} from '../../src/lib/motion-tokens';

/**
 * A conforming theme, written the way the contract asks for it.
 *
 * Used as the base of every plant below, so each test changes exactly one thing and the last
 * test proves the base itself is silent. A plant that fails for two reasons proves nothing
 * about either.
 */
function conforming(overrides: { light?: string; dark?: string; reduced?: string } = {}): string {
  const motion = [
    '  --oref-motion-fast: 80ms;',
    '  --oref-motion-normal: 160ms;',
    '  --oref-motion-none: 0s;',
    '  --oref-motion-ease: cubic-bezier(0.2, 0, 0.13, 1);',
  ].join('\n');

  return [
    '/* A comment naming --oref-motion-fast, which is prose and not a declaration. */',
    ':root,',
    "[data-oref-color-scheme='light'] {",
    '  --oref-color-bg: #ffffff;',
    overrides.light ?? motion,
    '}',
    '',
    "[data-oref-color-scheme='dark'] {",
    '  --oref-color-bg: #000000;',
    overrides.dark ?? motion,
    '}',
    '',
    '@media (prefers-reduced-motion: reduce) {',
    '  :root,',
    "  [data-oref-color-scheme='light'],",
    "  [data-oref-color-scheme='dark'] {",
    overrides.reduced ??
      [
        '    --oref-motion-fast: var(--oref-motion-none);',
        '    --oref-motion-normal: var(--oref-motion-none);',
      ].join('\n'),
    '  }',
    '}',
    '',
  ].join('\n');
}

describe('readBlocks', () => {
  it('should keep the at-rules a declaration sits inside', () => {
    // Given
    const css = '@media (prefers-reduced-motion: reduce) { :root { --oref-motion-fast: 0s; } }';

    // When
    const blocks = readBlocks(css);

    // Then
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.prelude).toBe('@media (prefers-reduced-motion: reduce) :root');
    expect(blocks[0]?.declarations.get('--oref-motion-fast')).toBe('0s');
  });

  it('should read a declaration prettier wrapped across lines', () => {
    // Given, the same reason `css-literals.ts` gives: a line based scan sees a value that is
    // not on the line its property is on as no value at all.
    const css = [
      ':root {',
      '  --oref-motion-ease: cubic-bezier(',
      '    0.2,',
      '    0,',
      '    1',
      '  );',
      '}',
    ].join('\n');

    // When
    const value = readBlocks(css)[0]?.declarations.get('--oref-motion-ease');

    // Then
    expect(value).toBe('cubic-bezier( 0.2, 0, 1 )');
  });

  it('should ignore a token name written inside a comment', () => {
    // Given
    const css = '/* --oref-motion-fast: 999ms; */ :root { --oref-motion-none: 0s; }';

    // When
    const declarations = readBlocks(css)[0]?.declarations;

    // Then
    expect([...(declarations?.keys() ?? [])]).toEqual(['--oref-motion-none']);
  });
});

describe('resolveToken', () => {
  it('should follow an alias chain to the value a browser computes', () => {
    // Given
    const values = new Map([
      ['--a', 'var(--b)'],
      ['--b', 'var(--c)'],
      ['--c', '0s'],
    ]);

    // When
    const resolved = resolveToken('--a', values);

    // Then
    expect(resolved).toBe('0s');
  });

  it('should take the fallback when the referenced token is unset', () => {
    // Given
    const values = new Map([['--a', 'var(--missing, 0ms)']]);

    // When
    const resolved = resolveToken('--a', values);

    // Then
    expect(resolved).toBe('0ms');
  });

  it('should refuse a cycle rather than following it', () => {
    // Given
    const values = new Map([
      ['--a', 'var(--b)'],
      ['--b', 'var(--a)'],
    ]);

    // When
    const resolved = resolveToken('--a', values);

    // Then
    expect(resolved).toBeNull();
  });
});

describe('auditMotionTokens', () => {
  it('should report a theme that declares motion in one colour mode and not the other', () => {
    // Given, the failure a check over the union of the blocks would call conforming.
    const css = conforming({ dark: '  --oref-motion-none: 0s;' });

    // When
    const findings = auditMotionTokens('planted', css);

    // Then
    expect(findings).toHaveLength(1);
    expect(findings[0]?.reason).toContain("[data-oref-color-scheme='dark']");
    expect(findings[0]?.reason).toContain('--oref-motion-fast');
  });

  it('should report a theme with no reduced motion block', () => {
    // Given, the whole reason the durations are tokens: without the block nothing can tell a
    // theme that forgot from a theme that has nothing to reduce.
    const css = conforming().replace(/@media \(prefers-reduced-motion: reduce\)[\s\S]*$/, '');

    // When
    const findings = auditMotionTokens('planted', css);

    // Then
    expect(findings).toHaveLength(1);
    expect(findings[0]?.reason).toContain('prefers-reduced-motion');
  });

  it('should report a duration that keeps running under reduced motion', () => {
    // Given, a block that reduces one duration and forgets the other.
    const css = conforming({ reduced: '    --oref-motion-fast: var(--oref-motion-none);' });

    // When
    const findings = auditMotionTokens('planted', css);

    // Then
    expect(findings).toHaveLength(1);
    expect(findings[0]?.reason).toBe(
      '--oref-motion-normal resolves to 160ms under reduced motion, and it has to resolve to zero',
    );
  });

  it('should accept a literal zero as readily as an alias to the zero token', () => {
    // Given, what is checked is where the chain ends, because that is what a browser computes.
    const css = conforming({
      reduced: ['    --oref-motion-fast: 0ms;', '    --oref-motion-normal: 0s;'].join('\n'),
    });

    // When
    const findings = auditMotionTokens('planted', css);

    // Then
    expect(findings).toEqual([]);
  });

  it('should report a zero token that is not zero, which every alias then inherits', () => {
    // Given, the one declaration that makes an otherwise correct reduced motion block a lie.
    const css = conforming().replaceAll('--oref-motion-none: 0s;', '--oref-motion-none: 120ms;');

    // When
    const findings = auditMotionTokens('planted', css);

    // Then
    expect(findings.map((finding) => finding.reason)).toEqual([
      '--oref-motion-fast resolves to 120ms under reduced motion, and it has to resolve to zero',
      '--oref-motion-normal resolves to 120ms under reduced motion, and it has to resolve to zero',
      '--oref-motion-none resolves to 120ms under reduced motion, and it has to resolve to zero',
    ]);
  });

  it('should report a curve written into a duration token', () => {
    // Given, a duration that is not a duration would otherwise be resolved and compared as one.
    const css = conforming().replaceAll(
      '--oref-motion-fast: 80ms;',
      '--oref-motion-fast: ease-out;',
    );

    // When
    const findings = auditMotionTokens('planted', css);

    // Then
    expect(findings.map((finding) => finding.reason)).toContain(
      '--oref-motion-fast resolves to ease-out, which is not a duration',
    );
  });

  it('should report a stylesheet holding no tokens at all rather than passing it', () => {
    // Given, an empty or wrong file is the one input that would otherwise satisfy every check
    // by having nothing to check.
    const css = '.oref-body { color: red; }';

    // When
    const findings = auditMotionTokens('planted', css);

    // Then
    expect(findings).toEqual([
      { level: 'error', theme: 'planted', reason: 'declares no --oref- tokens at all' },
    ]);
  });

  it('should say nothing about a conforming theme, with every plant removed', () => {
    // Given, without this the tests above only prove that the check can fire.
    const css = conforming();

    // When
    const findings = auditMotionTokens('planted', css);

    // Then
    expect(findings).toEqual([]);
    expect(MOTION_TOKENS).toHaveLength(4);
    expect(MOTION_DURATIONS).not.toContain('--oref-motion-ease');
  });
});
