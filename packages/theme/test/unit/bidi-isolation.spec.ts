import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Text the document supplied is isolated from the text around it, per T016 finding F13.
 *
 * WHAT THE ATTACK IS, because it is not an injection and reads like a typo until it is not. A
 * bidirectional override, U+202E, is a legal character. It survives HTML escaping, it survives
 * the sanitizer of SPEC 19.1, and it carries no markup, so every proof this project has goes on
 * passing while it works. What it does is reorder what a reader sees: measured on a page of this
 * renderer, an override placed in an operation summary reaches out of the summary and reverses
 * the chrome after it, and one placed in a route shows `/v1/refund` for a document that says
 * `/v1/attack`. A reference whose whole purpose is to tell a reader what an endpoint does is
 * exactly the surface where that matters.
 *
 * WHY ISOLATION AND NOT STRIPPING. Removing the directional controls would break every document
 * written in a right to left script, which needs them to say what it means. The fix would then
 * cost more than the attack, and it is the shape this project has rejected twice before: buying
 * a guarantee by inventing a constraint on legal documents. `unicode-bidi: isolate` costs an
 * Arabic or Hebrew description nothing and confines an unterminated override to the element
 * carrying it.
 *
 * THIS TEST CHECKS THE LIST AND NOT THE RENDERING, and says so rather than implying more. jsdom
 * performs no bidirectional layout, so nothing here can prove a browser reorders anything. What
 * it can prove, and what would have caught the defect, is that every class carrying text the
 * document supplied is in the rule. A surface added later without being added here fails.
 */

/** Every class of the renderer that carries text a specification supplied. */
const DOCUMENT_TEXT_CLASSES: readonly string[] = [
  'oref-body',
  'oref-brand-title',
  'oref-brand-version',
  'oref-description',
  // The runtime and drift surfaces of T023. Their text comes from the application rather than
  // from the specification file, which makes no difference to this attack: a controller name, a
  // scope, an error title and the two sides of a finding are all strings this project prints and
  // does not write, and an override in any of them reorders the row it lives in.
  'oref-drift-fix',
  'oref-drift-message',
  'oref-drift-side',
  'oref-drift-subject',
  'oref-example',
  'oref-media-schema',
  'oref-nav-label',
  'oref-palette-label',
  'oref-param-doc',
  'oref-param-name',
  'oref-path',
  'oref-response-doc',
  'oref-runtime-item',
  'oref-runtime-note',
  'oref-schema-doc',
  'oref-schema-name',
  'oref-security-scopes',
  'oref-server',
  'oref-subtitle',
  'oref-title',
];

function themeCss(): string {
  return readFileSync(join(import.meta.dirname, '..', '..', 'src', 'styles', 'theme.css'), 'utf8');
}

/** The stylesheet with its comments removed, so prose about a declaration is not one. */
function declarationsOnly(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//gu, '');
}

/** The selector list of the one rule that declares the isolation. */
function isolatedClasses(css: string): readonly string[] {
  const rule = /([^{}]+)\{[^{}]*unicode-bidi:\s*isolate[^{}]*\}/u.exec(declarationsOnly(css));
  if (rule === null) return [];

  return [...(rule[1] ?? '').matchAll(/\.([a-z0-9-]+)/gu)].map((match) => match[1] ?? '');
}

describe('the isolation of text the document supplied', () => {
  it('should isolate every class that carries text a specification supplied', () => {
    // Given
    const css = themeCss();

    // When
    const isolated = isolatedClasses(css);

    // Then
    expect([...isolated].sort()).toEqual([...DOCUMENT_TEXT_CLASSES].sort());
  });

  it('should carry the route and the summary, which are what an override lies about', () => {
    // Given, named separately from the list above because they are the two the attack is worth
    // mounting on: a reader checks a route before they call it and a summary before they read on
    // When
    const isolated = isolatedClasses(themeCss());

    // Then
    expect(isolated).toContain('oref-path');
    expect(isolated).toContain('oref-title');
  });

  it('should declare it as a class rule, because an inline style has no nonce', () => {
    // Given the constraint of SPEC 19.2, which is why this is CSS and not an attribute
    const css = themeCss();

    // When
    const declarations = [...declarationsOnly(css).matchAll(/unicode-bidi:/gu)];

    // Then, one rule and not one per component, so there is one place to read it
    expect(declarations).toHaveLength(1);
    expect(css).not.toContain('style="');
  });
});
