import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  TEXT_SOURCE_EXPECTED_TREES,
  TEXT_SOURCE_EXTENSIONS,
  TEXT_SOURCE_MIN_FILES,
} from '../../src/config';
import { textSourceGate } from '../../src/gates/text-source.gate';
import { formatGate } from '../../src/gates/format.gate';
import {
  BIDI_CONTROLS,
  bidiControlsIn,
  collectSourceFiles,
  firstByteFault,
  positionOfByte,
  scanSourceText,
} from '../../src/lib/text-source';
import { GATES } from '../../src/run';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/**
 * Builds a repository root holding one source file with the given bytes.
 *
 * @param name - Repository relative path of the file
 * @param bytes - Its contents
 * @returns Absolute path of the planted root, to be removed by the caller
 */
function plant(name: string, bytes: Uint8Array | string): string {
  const root = mkdtempSync(join(tmpdir(), 'openref-text-'));
  const target = join(root, name);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes);

  return root;
}

describe('firstByteFault', () => {
  it('should find a NUL byte and report the offset it is at', () => {
    // Given, the shape that hid in TryItPanel.ts: an ordinary line with one NUL in a literal.
    const bytes = Buffer.from("const BINARY_FIELD = '\u0000body';\n", 'utf8');

    // When
    const fault = firstByteFault(bytes);

    // Then
    expect(fault).toEqual({ reason: 'nul-byte', offset: 22 });
  });

  it('should read a file of ordinary source as having no fault', () => {
    // Given
    const bytes = Buffer.from('export const NAME = "openref";\n', 'utf8');

    // When
    const fault = firstByteFault(bytes);

    // Then
    expect(fault).toBeUndefined();
  });

  it('should accept the non ASCII text this repository actually contains', () => {
    // Given, Cyrillic prose in CLAUDE.md and the box drawing characters in its tables, both of
    // which a naive "every byte under 128" check would refuse.
    const bytes = Buffer.from('Перед началом работы ├── src/ 型 \u{1F600}\n', 'utf8');

    // When
    const fault = firstByteFault(bytes);

    // Then
    expect(fault).toBeUndefined();
  });

  it('should refuse a lone continuation byte, which is what a truncated UTF-8 file looks like', () => {
    // Given
    const bytes = Uint8Array.from([0x61, 0x62, 0x80, 0x63]);

    // When
    const fault = firstByteFault(bytes);

    // Then
    expect(fault).toEqual({ reason: 'invalid-utf8', offset: 2 });
  });

  it('should refuse a surrogate and an overlong form, which decode to nothing legal', () => {
    // Given, ED A0 80 is the first half of a surrogate pair and C0 80 is NUL written the long way,
    // which is the encoding a check that looked only for a literal zero byte would miss.
    const surrogate = Uint8Array.from([0xed, 0xa0, 0x80]);
    const overlong = Uint8Array.from([0xc0, 0x80]);

    // When
    const first = firstByteFault(surrogate);
    const second = firstByteFault(overlong);

    // Then
    expect(first).toEqual({ reason: 'invalid-utf8', offset: 0 });
    expect(second).toEqual({ reason: 'invalid-utf8', offset: 0 });
  });

  it('should refuse a multi byte sequence cut off by the end of the file', () => {
    // Given
    const bytes = Uint8Array.from([0x61, 0xe2, 0x94]);

    // When
    const fault = firstByteFault(bytes);

    // Then
    expect(fault).toEqual({ reason: 'invalid-utf8', offset: 1 });
  });
});

describe('positionOfByte', () => {
  it('should count lines and byte columns from one', () => {
    // Given
    const bytes = Buffer.from('one\ntwo\nthree', 'utf8');

    // When
    const position = positionOfByte(bytes, 8);

    // Then
    expect(position).toEqual({ line: 3, column: 1 });
  });
});

describe('collectSourceFiles', () => {
  it('should skip build output and dependencies rather than reporting on them', () => {
    // Given, a minified bundle with a NUL in it is a fact about a build, and a dependency with one
    // is a fact about somebody else's package. Neither is a source file of this repository.
    const root = plant('src/a.ts', 'export const a = 1;\n');
    writeFileSync(join(root, 'src', 'b.ts'), 'export const b = 2;\n');
    mkdirSync(join(root, 'dist'), { recursive: true });
    writeFileSync(join(root, 'dist', 'bundle.js'), 'export const a=1;\n');
    mkdirSync(join(root, 'node_modules', 'left-pad'), { recursive: true });
    writeFileSync(join(root, 'node_modules', 'left-pad', 'index.js'), 'module.exports = 1;\n');

    // When
    const files = collectSourceFiles(root, TEXT_SOURCE_EXTENSIONS, root);
    rmSync(root, { recursive: true, force: true });

    // Then
    expect(files).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('should leave a font out by never naming its extension', () => {
    // Given
    const root = plant('fonts/fonts.css', '@font-face { font-family: x; }\n');
    writeFileSync(join(root, 'fonts', 'x.woff2'), Uint8Array.from([0x77, 0x4f, 0x46, 0x32, 0x00]));

    // When
    const files = collectSourceFiles(root, TEXT_SOURCE_EXTENSIONS, root);
    rmSync(root, { recursive: true, force: true });

    // Then
    expect(files).toEqual(['fonts/fonts.css']);
  });
});

/**
 * The character under test, built rather than written.
 *
 * WRITING IT AS A LITERAL HERE WOULD PLANT THE DEFECT IN THE REPOSITORY, and the gate caught
 * exactly that on its first run over this file: two overrides in the test that proves overrides
 * are refused. The escape is the same value and leaves the file readable in the order it is
 * written, which is the remedy the finding itself prints.
 */
const OVERRIDE = String.fromCodePoint(0x202e);

describe('bidiControlsIn', () => {
  it('should find the override SPEC 19.1 names, at the byte its encoding starts on', () => {
    // Given a comment that reads one way to a person and another to the compiler
    const bytes = Buffer.from(`const rate = 1; // ${OVERRIDE}tnuocsid on\n`, 'utf8');

    // When
    const found = bidiControlsIn(bytes);

    // Then
    expect(found).toEqual([{ codePoint: 0x202e, offset: 19 }]);
  });

  it('should find every control of the set, not the override alone', () => {
    // Given. An unterminated embedding reorders exactly as an override does, and an isolate does
    // the same to everything after it, so a check that knew one spelling would pass eleven.
    const points = [...BIDI_CONTROLS.keys()];

    // When
    const found = points.map((point) => bidiControlsIn(Buffer.from(String.fromCodePoint(point))));

    // Then
    expect(found.map((hits) => hits[0]?.codePoint)).toEqual(points);
  });

  it('should leave ordinary non ASCII text alone, Cyrillic and emoji included', () => {
    // Given the text this repository actually holds. A check that refused every multi byte
    // sequence would refuse CLAUDE.md, which is the cure costing more than the disease.
    const bytes = Buffer.from('Перед началом работы ├── src/ 型 \u{1F600}\n', 'utf8');

    // When
    const found = bidiControlsIn(bytes);

    // Then
    expect(found).toEqual([]);
  });
});

describe('textSourceGate', () => {
  it('should pass on the committed tree, having read the whole checkout', async () => {
    // Given, the state this session put the repository into: the one NUL byte is now the escape
    // \u0000 and nothing else under packages or tools refuses a text tool.
    const context = { repoRoot };

    // When
    const result = await textSourceGate.run(context);

    // Then
    expect(result.findings.filter((finding) => finding.level === 'error')).toEqual([]);
    expect(result.status).toBe('pass');
    expect(result.findings.some((finding) => /^read \d+ file\(s\):/.test(finding.message))).toBe(
      true,
    );
  });

  it('should fail on a planted bidirectional override, which every other check reads as clean', async () => {
    // Given a source file that is valid UTF-8, compiles, passes its tests, and shows a reviewer a
    // line that is not the line the compiler reads. Before T042 this scan passed it.
    const source = `const refund = true; // ${OVERRIDE}eurt = kcatta tsuj\n`;
    const root = plant('packages/core/src/refund.ts', source);

    // When
    const result = await textSourceGate.run({ repoRoot: root });
    rmSync(root, { recursive: true, force: true });
    const errors = result.findings.filter((finding) => finding.level === 'error');

    // Then
    expect(result.status).toBe('fail');
    expect(errors[0]?.message).toContain('packages/core/src/refund.ts');
    expect(errors[0]?.message).toContain('U+202E RIGHT-TO-LEFT OVERRIDE');
    expect(errors[0]?.message).toContain('line 1 column 25');
  });

  it('should count the trees the old root list never reached', () => {
    // Given the hole T035 filed: the scan walked packages and tools, so examples, compat, .github
    // and every root level file including vitest.shared.ts were checked by nothing.
    const scan = scanSourceText(repoRoot, TEXT_SOURCE_EXTENSIONS);

    // When
    const trees = new Map(scan.trees.map((tree) => [tree.tree, tree.scanned]));

    // Then
    for (const tree of ['examples', 'compat', '.github', '<root file>']) {
      expect(trees.get(tree) ?? 0).toBeGreaterThan(0);
    }
    expect(scan.scanned).toBeGreaterThan((trees.get('packages') ?? 0) + (trees.get('tools') ?? 0));
  });

  it('should fail by name when a tree a reader can run yields nothing', async () => {
    // Given a checkout holding enough files to clear the floor and missing every small tree. A
    // total cannot see one of those leaving the scan, which is the half of the T035 finding no
    // floor could ever answer.
    const root = plant('packages/core/src/a0.ts', 'export const a0 = 0;\n');
    for (let index = 1; index <= TEXT_SOURCE_MIN_FILES; index += 1) {
      writeFileSync(
        join(root, 'packages', 'core', 'src', `a${String(index)}.ts`),
        `export const a${String(index)} = ${String(index)};\n`,
      );
    }
    mkdirSync(join(root, 'tools'), { recursive: true });
    writeFileSync(join(root, 'tools', 'x.ts'), 'export const x = 1;\n');

    // When
    const result = await textSourceGate.run({ repoRoot: root });
    rmSync(root, { recursive: true, force: true });
    const errors = result.findings.filter((finding) => finding.level === 'error');

    // Then, the floor is clear and the gate still fails, naming each tree that vanished
    expect(result.status).toBe('fail');
    expect(errors.map((finding) => finding.message).join('\n')).toContain(
      'examples yielded no file this scan reads',
    );
    expect(errors.every((finding) => !finding.message.includes('below the floor'))).toBe(true);
  });

  it('should fail on a planted NUL byte, naming the file and the line it is on', async () => {
    // Given the defect exactly as it was found, in a file that is otherwise ordinary source and
    // that every other gate is happy with.
    const source = `const a = 1;\nconst BINARY_FIELD = '\u0000body';\n`;
    const root = plant('packages/render/src/components/TryItPanel.ts', source);

    // When
    const result = await textSourceGate.run({ repoRoot: root });
    rmSync(root, { recursive: true, force: true });
    const errors = result.findings.filter((finding) => finding.level === 'error');

    // Then, the fault is named before the floor is, because the file is what a reader must fix.
    expect(result.status).toBe('fail');
    expect(errors[0]?.message).toContain('packages/render/src/components/TryItPanel.ts');
    expect(errors[0]?.message).toContain('nul-byte at byte 35, line 2 column 23');
    expect(errors[0]?.message).toContain('\\u0000');
  });

  it('should fail a scan that reached nothing rather than reporting a clean tree', async () => {
    // Given an empty root, which is what a mistyped scan root produces. It finds no fault, and a
    // gate that called that a pass would be the absence defect of SPEC 0 in its purest form.
    const root = mkdtempSync(join(tmpdir(), 'openref-text-'));

    // When
    const result = await textSourceGate.run({ repoRoot: root });
    rmSync(root, { recursive: true, force: true });

    // Then
    const errors = result.findings.filter((finding) => finding.level === 'error');
    expect(result.status).toBe('fail');
    expect(errors.map((finding) => finding.message).join('\n')).toContain(
      'only 0 file(s) were read',
    );
    expect(errors.map((finding) => finding.message).join('\n')).toContain('checked nothing');
  });

  it('should read every tree the plan expects, so none of them is checked by nothing', () => {
    // Given, the gate's own package lives under tools, the product under packages, and a reader
    // can run what is under examples and compat. A scan of a subset leaves the rest in exactly
    // the state this gate exists to end.
    const scan = scanSourceText(repoRoot, TEXT_SOURCE_EXTENSIONS);

    // When
    const reached = new Set(scan.trees.map((tree) => tree.tree));

    // Then
    for (const tree of TEXT_SOURCE_EXPECTED_TREES) expect(reached.has(tree)).toBe(true);
    expect(scan.scanned).toBeGreaterThan(TEXT_SOURCE_MIN_FILES);
    expect(scan.unreadable).toEqual([]);
    expect(scan.bidi).toEqual([]);
  });

  it('should run beside the format gate, before anything that reads an artifact', () => {
    // Given
    const order = GATES.map((gate) => gate.id);

    // When
    const position = order.indexOf(textSourceGate.id);

    // Then
    expect(order[position - 1]).toBe(formatGate.id);
  });
});
