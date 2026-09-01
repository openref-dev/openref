import { describe, expect, it } from 'vitest';
import { CLAIMS } from '../../src/claims.ts';
import {
  documentationSpecification,
  guideChapters,
  guideMarkdown,
  typescriptExamplesIn,
} from '../../src/index.ts';

/**
 * The guide, and the one property the maintainer's acceptance bar is about.
 *
 * SPEC 2 SAYS THE FIRST MINUTE IS THE INSTALL, THE ONE LINE, AND WHAT ARRIVES, and that if the
 * opening starts by explaining packages, the model, federation or theme levels then the project
 * is not installed however accurate the page is. So the assertion here is about position and
 * not about presence: the install command has to come before every one of those words, in the
 * text a reader meets first.
 */

/** The words SPEC 2 names as the ones that must not open the page. */
/**
 * The four SPEC 2 names, matched on a word boundary and in the words a reader meets.
 *
 * PATTERNS AND NOT STRINGS, BECAUSE ONE OF THE FOUR PROVED NOTHING. The first version searched
 * for the substring `IR` and found it at 17,723 inside `REQUIRED_HEADERS_KEY`, an identifier in
 * a code block with no relation to the model, so that term asserted an ordering about a
 * coincidence and the case really covered three of four.
 *
 * AND `IR` IS NOT ON THE LIST, BECAUSE THE GUIDE NEVER SAYS IT. On a word boundary the acronym
 * has no occurrence at all, so it can prove no ordering either; what the guide calls the thing
 * is `normalized model`, which is the term a reader meets and the one carried here. The absence
 * of the acronym is asserted in its own case rather than left as a pattern that matches nothing.
 */
const ARCHITECTURE_WORDS: readonly RegExp[] = [
  /\bfederation\b/i,
  /\btheme level\b/i,
  /\bnormalized model\b/i,
  /\bcollectors?\b/i,
  /\bpackages?\b/i,
];

describe('the guide', () => {
  it('should have chapters, in filename order, before anything is proved about their content', () => {
    // Given
    const chapters = guideChapters();

    // Then
    expect(chapters.length).toBeGreaterThan(5);
    expect([...chapters].map((chapter) => chapter.file)).toEqual(
      [...chapters].map((chapter) => chapter.file).sort(),
    );
    for (const chapter of chapters) expect(chapter.markdown.trim().length).toBeGreaterThan(200);
  });

  it('should open with the install command and the one line of setup', () => {
    // Given
    const guide = guideMarkdown();

    // When
    const opening = guide.slice(0, 400);

    // Then
    expect(opening).toContain('npm i @openref/nest');
    expect(opening).toContain("OpenRefModule.setup('/docs', app, { document });");
  });

  it('should reach the install command before any architecture word', () => {
    // Given
    const guide = guideMarkdown();
    const install = guide.indexOf('npm i @openref/nest');

    // Then, presence first: a word that never appears cannot prove an ordering
    expect(install).toBeGreaterThanOrEqual(0);
    for (const word of ARCHITECTURE_WORDS) {
      const at = word.exec(guide)?.index ?? -1;
      expect(at, `${word.source} never appears, so it proves no ordering`).toBeGreaterThanOrEqual(
        0,
      );
      expect(at, `${word.source} appears before the install command`).toBeGreaterThan(install);
    }
  });

  it('should never use the acronym SPEC 2 warns an opening must not lead with', () => {
    // Given
    const guide = guideMarkdown();

    // Then, on a word boundary: the substring occurs inside identifiers in code blocks, and
    // those are not the reader meeting a piece of architecture vocabulary
    expect(/\bIR\b/.exec(guide)).toBeNull();
    expect(guide).toContain('normalized model');
  });

  it('should open with the claims the claim table makes about a bare mount, in its order', () => {
    // Given
    const opening = guideMarkdown().slice(0, 1200);

    // THE SENTENCES ARE NOT WRITTEN HERE EITHER. This case used to carry four literal lines,
    // which is a third copy of a claim beside the prose and the suite: the wording moved once
    // and this file was the last to hear. It reads the table the generator emits from.
    // Then
    for (const claim of CLAIMS.filter((entry) => entry.context === 'bare-mount')) {
      expect(opening, claim.id).toContain(claim.sentence);
    }
  });

  it('should put the claims that need a collector after the ones that do not', () => {
    // Given
    const guide = guideMarkdown();
    const last = Math.max(
      ...CLAIMS.filter((claim) => claim.context === 'bare-mount').map((claim) =>
        guide.indexOf(claim.sentence),
      ),
    );

    // Then, presence first, then position
    expect(last).toBeGreaterThan(0);
    for (const claim of CLAIMS.filter((entry) => entry.context === 'printed-block')) {
      const at = guide.indexOf(claim.sentence);
      expect(at, claim.id).toBeGreaterThan(last);
    }
    expect(guide).toContain('OpenRefModule.forRoot({');
  });

  it('should carry no em dash and no en dash', () => {
    // Given
    const guide = guideMarkdown();

    // THE TWO CHARACTERS ARE WRITTEN AS ESCAPES, WHICH IS THE POINT AND NOT A STYLE CHOICE. The
    // first version of this case carried them literally, so the file that checks the rule was the
    // file that broke it, and the commit hook that enforces the rule refused the commit. A test
    // about a forbidden character cannot spell it.
    // Then
    expect(guide.includes('\u2014')).toBe(false);
    expect(guide.includes('\u2013')).toBe(false);
  });

  it('should reach the document as its description, unabridged', () => {
    // Given
    const specification = documentationSpecification() as { info: { description: string } };

    // Then
    expect(specification.info.description).toBe(guideMarkdown());
  });

  it('should hold TypeScript examples, which is what the compile suite has to compile', () => {
    // Given
    const examples = typescriptExamplesIn(guideMarkdown());

    // Then
    expect(examples.length).toBeGreaterThan(10);
    expect(examples.every((example) => example.trim().length > 0)).toBe(true);
  });

  it('should not read a fence of another language as TypeScript', () => {
    // Given
    const markdown = '```bash\nnpm i x\n```\n\n```ts\nconst a = 1;\n```\n';

    // When
    const examples = typescriptExamplesIn(markdown);

    // Then
    expect(examples).toEqual(['const a = 1;\n']);
  });
});
