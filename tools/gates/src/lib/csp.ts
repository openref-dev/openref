/**
 * Static scan for constructs that a strict Content Security Policy cannot authorize.
 *
 * OPENREF must work under `style-src 'self' 'nonce-...'` and `script-src 'self' 'nonce-...'`
 * with no `unsafe-inline` and no `unsafe-eval`. A nonce can authorize a `<style>` or
 * `<script>` element, never a `style` attribute, so inline style attributes are fatal.
 */

/** A single construct that would be blocked by a strict policy. */
export interface CspViolation {
  readonly rule: string;
  readonly reason: string;
  readonly excerpt: string;
}

interface CspRule {
  readonly rule: string;
  readonly reason: string;
  readonly pattern: RegExp;
  /** Returns true when a raw match is a real violation rather than an allowed form. */
  readonly isViolation?: (match: string) => boolean;
}

const RULES: readonly CspRule[] = [
  {
    rule: 'inline-style-attribute',
    reason: 'a nonce cannot authorize a style attribute; use a class and a CSS custom property',
    pattern: /(?:^|[\s'"`;{(])style\s*=\s*(?:["'][^"']*["']|\{)/g,
  },
  {
    rule: 'vue-style-binding',
    reason: 'a bound style attribute renders as an inline style attribute',
    pattern: /(?::style|v-bind:style)\s*=/g,
  },
  {
    rule: 'inline-script-element',
    reason: 'an inline script element must carry a nonce',
    pattern: /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,
    isViolation: (match) => {
      const openTag = /^<script\b[^>]*>/i.exec(match)?.[0] ?? '';
      if (/\bnonce\s*=/i.test(openTag)) return false;
      if (/\bsrc\s*=/i.test(openTag)) return false;
      const body = match.replace(/^<script\b[^>]*>/i, '').replace(/<\/script\s*>$/i, '');
      return body.trim().length > 0;
    },
  },
  {
    rule: 'inline-style-element',
    reason: 'an inline style element must carry a nonce',
    pattern: /<style\b[^>]*>/gi,
    isViolation: (match) => !/\bnonce\s*=/i.test(match),
  },
  {
    rule: 'dynamic-code-evaluation',
    reason: "eval and the Function constructor require 'unsafe-eval'",
    pattern: /\beval\s*\(|\bnew\s+Function\s*\(/g,
  },
];

/**
 * Scans a text artifact for constructs a strict CSP would block.
 *
 * @param content - Contents of a built JavaScript, CSS or HTML file
 * @returns Every violation found, in the order it appears in the file
 */
export function scanForCspViolations(content: string): CspViolation[] {
  const violations: CspViolation[] = [];

  for (const rule of RULES) {
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
    let match = pattern.exec(content);

    while (match !== null) {
      const raw = match[0];
      if (rule.isViolation === undefined || rule.isViolation(raw)) {
        violations.push({
          rule: rule.rule,
          reason: rule.reason,
          excerpt: excerptOf(raw),
        });
      }
      match = pattern.exec(content);
    }
  }

  return violations;
}

function excerptOf(raw: string): string {
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  return collapsed.length > 120 ? `${collapsed.slice(0, 117)}...` : collapsed;
}
