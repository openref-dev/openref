import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLAIMS } from '../../src/claims.ts';
import {
  EXPECTED_REGIONS,
  expandGenerated,
  generatedSurfaces,
  REPOSITORY_ROOT,
  UNGENERATED_FIGURES,
} from '../../src/generate.ts';

/**
 * The generated regions of the documentation, held to what they are generated from.
 *
 * THIS IS THE CHECK THAT MAKES A STALE REGION UNABLE TO SHIP. `pnpm docs:build` expands every
 * surface before it composes the site, so a reader who runs the documented command gets the
 * expanded prose; this file expands them again and fails if a byte moves, so a commit that
 * edited a generated region by hand, or changed a fact without rebuilding, is red.
 *
 * IT IS ALSO WHERE THE OLD SCANNER USED TO BE. A suite that read fenced blocks looking for
 * promise lines was deleted with the sixth review, which found five spellings that walked around
 * it. Nothing here reads prose: it compares generated text with generated text.
 */

describe('the generated documentation', () => {
  it('should have surfaces to check, before anything is proved about them', () => {
    // Then
    expect(generatedSurfaces().length).toBeGreaterThan(12);
    for (const file of generatedSurfaces()) {
      expect(readFileSync(file, 'utf8').length).toBeGreaterThan(100);
    }
  });

  it('should carry exactly the regions each surface is expected to carry', () => {
    // Given
    const wrong: string[] = [];

    for (const [surface, expected] of Object.entries(EXPECTED_REGIONS)) {
      const text = readFileSync(join(REPOSITORY_ROOT, surface), 'utf8');
      const present = [
        ...new Set([...text.matchAll(/<!-- gen: ([^>]+?) -->/g)].map((match) => match[1] ?? '')),
      ].sort();
      const wanted = [...new Set(expected)].sort();

      // BOTH DIRECTIONS AND PER SURFACE. Deleting a region's markers and keeping its text used
      // to be green: the block became hand prose and never regenerated again. So did deleting a
      // whole region from one file, because the checks joined every surface into one string and
      // asked whether a claim appeared anywhere at all.
      if (JSON.stringify(present) !== JSON.stringify(wanted)) {
        wrong.push(`${surface}: has ${present.join(', ')}; expects ${wanted.join(', ')}`);
      }
    }

    // Then
    expect(Object.keys(EXPECTED_REGIONS).length).toBeGreaterThan(10);
    expect(wrong).toEqual([]);
  });

  it('should expect regions only in surfaces that exist', () => {
    // Given
    const owned = new Set(
      generatedSurfaces().map((file) => file.slice(REPOSITORY_ROOT.length + 1)),
    );

    // Then
    expect(Object.keys(EXPECTED_REGIONS).filter((surface) => !owned.has(surface))).toEqual([]);
  });

  it('should still find every figure it records as ungenerated', () => {
    // Given the record of what stays hand written, and why
    const missing = UNGENERATED_FIGURES.filter(
      (figure) =>
        !readFileSync(join(REPOSITORY_ROOT, figure.surface), 'utf8').includes(figure.phrase),
    ).map((figure) => `${figure.surface}: ${figure.phrase}`);

    // Then: a record nothing holds to the files is a record that goes stale by editing
    expect(UNGENERATED_FIGURES.length).toBeGreaterThan(8);
    expect(missing).toEqual([]);
    for (const figure of UNGENERATED_FIGURES) expect(figure.lacks.length).toBeGreaterThan(20);
  });

  it('should be exactly what the generator produces, in every surface', () => {
    // Given
    const stale = generatedSurfaces()
      .filter((file) => {
        const text = readFileSync(file, 'utf8');
        return expandGenerated(text) !== text;
      })
      .map((file) => file.slice(REPOSITORY_ROOT.length + 1));

    // Then: run `pnpm docs:build`, which is what a reader runs and what regenerates these
    expect(stale).toEqual([]);
  });

  it('should be a fixed point, so expanding twice says the same thing', () => {
    // Given
    for (const file of generatedSurfaces()) {
      const once = expandGenerated(readFileSync(file, 'utf8'));

      // Then: a claim region moves every line under it, so a count read against the file before
      // that move gives a different answer the second time. Expanding claims and then counts is
      // what makes this hold, and it did not hold in the first version.
      expect(expandGenerated(once), file).toBe(once);
    }
  });

  it('should write every bare-mount claim into the prose a reader meets', () => {
    // Given
    const prose = generatedSurfaces()
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');

    // Then
    for (const claim of CLAIMS.filter((entry) => entry.context === 'bare-mount')) {
      expect(prose, claim.id).toContain(claim.sentence);
    }
  });
});
