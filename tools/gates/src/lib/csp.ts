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

/**
 * The two script types this repository writes that a browser never executes.
 *
 * A CLOSED LIST AND NOT A RULE ABOUT MIME TYPES, which is the whole of the care here. HTML calls a
 * `<script>` whose type is neither a JavaScript MIME type nor one of the language's own keywords a
 * data block: it is not parsed as script and `script-src` does not govern it, which is why a
 * browser reports nothing for either of these while the scan reported both. But `importmap` and
 * `speculationrules` are also not JavaScript MIME types and ARE governed, so a rule shaped as "not
 * JavaScript, therefore allowed" would open exactly the two spellings that matter. What is listed
 * is what this repository emits: `application/ld+json` from `renderShell`'s structured data and
 * `application/json` from the page model element. Anything else, `type="module"` and a bare
 * `<script>` included, stays a violation.
 *
 * Found at `T063`, which built the documentation site with the product and ran this scan over the
 * first rendered page it has ever seen: three violations reported and none reported by Chrome
 * under `default-src 'none'; script-src 'self'; style-src 'self'`.
 */
const DATA_BLOCK_TYPES: readonly string[] = ['application/json', 'application/ld+json'];

/**
 * Whether a `<script>` open tag declares one of the two data block types.
 *
 * THE ATTRIBUTE BOUNDARY IS A CHARACTER CLASS AND NOT `\b`, WHICH IS THE FIRST FORM'S DEFECT.
 * `\b` matches between `-` and `t`, so `data-type=` and `x-type=` read as `type=`; measured on the
 * first form, `<script data-type="application/json" type="module">alert(1)</script>` was ALLOWED,
 * because the scan found the first `type=` inside the data attribute and never reached the real
 * one. `data-oref-*` is this repository's own documented convention, so the spelling is not
 * hypothetical. The `inline-style-attribute` rule at the top of this file already uses the same
 * class for the same reason, and this one now agrees with it.
 *
 * THE LAST DECLARATION IS THE ONE READ, because HTML takes the FIRST of a repeated attribute and a
 * scan that took the first match of a permissive pattern would be reading a different attribute
 * from the parser. Reading every match and requiring them all to be a data block type is the
 * refusing direction: `type="module" type="application/json"` is a violation under this rule and an
 * executable script in a browser, which is the pair that has to agree.
 */
function isDataBlock(openTag: string): boolean {
  const declared = [
    ...openTag.matchAll(/(?:^|[\s'"`/])type\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi),
  ];
  if (declared.length === 0) return false;

  return declared.every((match) =>
    DATA_BLOCK_TYPES.includes((match[1] ?? match[2] ?? match[3] ?? '').trim().toLowerCase()),
  );
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
      if (isDataBlock(openTag)) return false;
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
