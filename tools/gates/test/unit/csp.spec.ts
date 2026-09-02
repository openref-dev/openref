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

  it('should accept the two data block script types this repository writes', () => {
    // Given, both spellings a rendered page carries, verbatim from `renderShell`.
    const content =
      '<script type="application/ld+json">{"@type":"WebSite"}</script>' +
      '<script type="application/json" id="oref-state">{"kind":"overview"}</script>';

    // When
    const violations = scanForCspViolations(content);

    // Then
    expect(violations).toEqual([]);
  });

  it('should still report an inline script with no type, which is the control for the two above', () => {
    // Given, the same shape with the one attribute removed. Without this the case above could
    // pass on a rule that had stopped reporting inline scripts at all.
    const content = '<script>{"kind":"overview"}</script>';

    // When
    const violations = scanForCspViolations(content);

    // Then
    expect(violations.map((violation) => violation.rule)).toEqual(['inline-script-element']);
  });

  it('should report every script type a browser does execute, however it is spelled', () => {
    // Given, `importmap` and `speculationrules` are not JavaScript MIME types and are governed by
    // `script-src` all the same, which is why the allowance is a closed list rather than a rule
    // about MIME types; `module` and a parameterized `application/json` are here for the same
    // reason, since a browser reads neither as one of the two written above.
    const executed = [
      '<script type="module">import x from "y";</script>',
      '<script type="importmap">{"imports":{}}</script>',
      '<script type="speculationrules">{"prerender":[]}</script>',
      '<script type="text/javascript">x();</script>',
      '<script type="">x();</script>',
      '<script type="application/json; charset=utf-8">{}</script>',
    ];

    // When
    const reported = executed.map((content) => scanForCspViolations(content).length);

    // Then
    expect(reported).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it('should not read a type out of an attribute that merely ends in type', () => {
    // Given, the bypass the first form of this rule admitted, measured: `\b` matches between `-`
    // and `t`, so the scan found `application/json` inside `data-type` and never reached the real
    // `type="module"` beside it. `data-oref-*` is this repository's own documented convention, so
    // none of these spellings is hypothetical.
    const disguised = [
      '<script data-type="application/json" type="module">alert(1)</script>',
      '<script data-type="application/json">alert(1)</script>',
      '<script x-type="application/json">alert(1)</script>',
      '<script data-oref-type="application/json">alert(1)</script>',
    ];

    // When
    const reported = disguised.map((content) => scanForCspViolations(content).length);

    // Then
    expect(reported).toEqual([1, 1, 1, 1]);
  });

  it('should refuse a repeated type attribute rather than take the first match', () => {
    // Given, HTML takes the FIRST of a repeated attribute, so this executes as a module; a scan
    // that took the first match of a permissive pattern would agree with the parser only by luck
    // and the other order would disagree with it outright.
    const both = [
      '<script type="module" type="application/json">alert(1)</script>',
      '<script type="application/json" type="module">alert(1)</script>',
    ];

    // When
    const reported = both.map((content) => scanForCspViolations(content).length);

    // Then, refused in both orders
    expect(reported).toEqual([1, 1]);
  });

  it('should still read a type that a newline or a tag boundary precedes', () => {
    // Given, the control for the boundary above: tightening it must not stop it reading a real
    // declaration written across lines, which is what a formatter produces.
    const spread = '<script\n  type="application/json"\n  id="oref-state">{}</script>';

    // When
    const violations = scanForCspViolations(spread);

    // Then
    expect(violations).toEqual([]);
  });

  it('should read the type however the attribute is quoted or cased', () => {
    // Given
    const spellings = [
      '<script type=application/json>{}</script>',
      "<script type='application/ld+json'>{}</script>",
      '<script TYPE="APPLICATION/JSON">{}</script>',
    ];

    // When
    const reported = spellings.map((content) => scanForCspViolations(content).length);

    // Then
    expect(reported).toEqual([0, 0, 0]);
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
