import { describe, expect, it } from 'vitest';
import { unformattedFiles } from '../../src/lib/format';

/**
 * Reading prettier's output, and the one way this could be quietly wrong.
 *
 * A PARSE THAT FINDS NO FILE IS THE FAILURE MODE THAT LOOKS LIKE SUCCESS, exactly as it is for
 * the module graph walker. If the marker prettier prints ever changes, this returns an empty
 * list, and an empty list is what a clean repository returns too. The gate is written so that an
 * empty list beside a non zero exit fails as the checker rather than passing as the repository,
 * and these cases hold the parse itself to the shapes that distinction rests on.
 */
describe('unformattedFiles', () => {
  it('should name every file prettier warned about', () => {
    // Given the output of a real failing run, summary line included
    const output = [
      'Checking formatting...',
      '[warn] packages/render/src/components/HealthPanel.ts',
      '[warn] tools/gates/src/lib/exec.ts',
      '[warn] Code style issues found in the above file(s). Run Prettier with --write to fix.',
    ].join('\n');

    // When
    const files = unformattedFiles(output);

    // Then
    expect(files).toEqual([
      'packages/render/src/components/HealthPanel.ts',
      'tools/gates/src/lib/exec.ts',
    ]);
  });

  it('should not take the summary line for a file, whichever plural it uses', () => {
    // Given, prettier writes "file" for one and "file(s)" for several, and both are warnings
    const output = [
      '[warn] tools/gates/src/lib/exec.ts',
      '[warn] Code style issues found in the above file. Run Prettier with --write to fix.',
    ].join('\n');

    // When
    const files = unformattedFiles(output);

    // Then
    expect(files).toEqual(['tools/gates/src/lib/exec.ts']);
  });

  it('should return nothing for a clean run', () => {
    // Given
    const output = 'Checking formatting...\nAll matched files use Prettier code style!';

    // When
    const files = unformattedFiles(output);

    // Then
    expect(files).toEqual([]);
  });

  it('should not read a crash as a list of files', () => {
    // Given a checker that could not run at all. This is the case the gate tells apart from a
    // clean repository by the exit code, and the parse has to contribute nothing to it.
    const output = '[error] Cannot find module "prettier"\nnode:internal/modules/cjs/loader:1215';

    // When
    const files = unformattedFiles(output);

    // Then
    expect(files).toEqual([]);
  });
});
