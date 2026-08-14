import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TEXT_SOURCE_EXTENSIONS, TEXT_SOURCE_MIN_FILES, TEXT_SOURCE_ROOTS } from '../../src/config';
import { textSourceGate } from '../../src/gates/text-source.gate';
import { formatGate } from '../../src/gates/format.gate';
import {
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

describe('textSourceGate', () => {
  it('should pass on the committed tree, having read several hundred files', async () => {
    // Given, the state this session put the repository into: the one NUL byte is now the escape
    // \u0000 and nothing else under packages or tools refuses a text tool.
    const context = { repoRoot };

    // When
    const result = await textSourceGate.run(context);

    // Then
    expect(result.findings.filter((finding) => finding.level === 'error')).toEqual([]);
    expect(result.status).toBe('pass');
    expect(result.findings[0]?.message).toMatch(/^\d+ source file\(s\)/);
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
    expect(result.status).toBe('fail');
    expect(result.findings[0]?.message).toContain('only 0 file(s) were read');
    expect(result.findings[0]?.message).toContain('checked nothing');
  });

  it('should walk both source roots, so neither is checked by nothing', () => {
    // Given, the gate's own package lives under tools and the product under packages. A scan of
    // one root would leave the other in exactly the state this gate exists to end.
    const scan = scanSourceText(repoRoot, TEXT_SOURCE_ROOTS, TEXT_SOURCE_EXTENSIONS);

    // When
    const roots = new Set(scan.unreadable.map((file) => file.path.split('/')[0]));

    // Then
    expect(TEXT_SOURCE_ROOTS).toEqual(['packages', 'tools']);
    expect(scan.scanned).toBeGreaterThan(TEXT_SOURCE_MIN_FILES);
    expect([...roots]).toEqual([]);
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
