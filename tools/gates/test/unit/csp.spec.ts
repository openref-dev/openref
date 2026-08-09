import { describe, expect, it } from 'vitest';
import { scanForCspViolations } from '../../src/lib/csp';

describe('scanForCspViolations', () => {
  it('should report an inline style attribute, which no nonce can authorize', () => {
    // Given
    const content = '<div class="oref-badge" style="color: red">200</div>';

    // When
    const violations = scanForCspViolations(content);

    // Then
    expect(violations.map((violation) => violation.rule)).toContain('inline-style-attribute');
  });

  it('should report a bound style attribute in a compiled template', () => {
    // Given
    const content = '<div :style="{ width: pct }"></div>';

    // When
    const violations = scanForCspViolations(content);

    // Then
    expect(violations.map((violation) => violation.rule)).toContain('vue-style-binding');
  });

  it('should report an inline script element with no nonce', () => {
    // Given
    const content = '<script>window.__OREF__ = {};</script>';

    // When
    const violations = scanForCspViolations(content);

    // Then
    expect(violations.map((violation) => violation.rule)).toContain('inline-script-element');
  });

  it('should accept an inline script element that carries a nonce', () => {
    // Given
    const content = '<script nonce="abc123">window.__OREF__ = {};</script>';

    // When
    const violations = scanForCspViolations(content);

    // Then
    expect(violations).toEqual([]);
  });

  it('should accept an external script element with no nonce', () => {
    // Given
    const content = '<script src="/openref/client.js"></script>';

    // When
    const violations = scanForCspViolations(content);

    // Then
    expect(violations).toEqual([]);
  });

  it('should report a style element with no nonce', () => {
    // Given
    const content = '<style>.oref-root { color: red; }</style>';

    // When
    const violations = scanForCspViolations(content);

    // Then
    expect(violations.map((violation) => violation.rule)).toContain('inline-style-element');
  });

  it('should accept a style element that carries a nonce', () => {
    // Given
    const content = '<style nonce="abc123">.oref-root { color: red; }</style>';

    // When
    const violations = scanForCspViolations(content);

    // Then
    expect(violations).toEqual([]);
  });

  it('should report dynamic code evaluation', () => {
    // Given
    const content = 'const compiled = new Function("return 1"); eval("2");';

    // When
    const violations = scanForCspViolations(content);

    // Then
    expect(
      violations.filter((violation) => violation.rule === 'dynamic-code-evaluation'),
    ).toHaveLength(2);
  });

  it('should accept output that carries no blocked construct', () => {
    // Given
    const content = '.oref-badge { color: var(--oref-color-fg); }';

    // When
    const violations = scanForCspViolations(content);

    // Then
    expect(violations).toEqual([]);
  });

  it('should truncate a long excerpt so the report stays readable', () => {
    // Given
    const content = `<div style="${'a'.repeat(400)}"></div>`;

    // When
    const violations = scanForCspViolations(content);

    // Then
    expect(violations[0]?.excerpt.length).toBe(120);
    expect(violations[0]?.excerpt.endsWith('...')).toBe(true);
  });
});
