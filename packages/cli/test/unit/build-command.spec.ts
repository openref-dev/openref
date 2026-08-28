import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildReportText, runBuild } from '../../src/cli/api/commands/build.command';
import type { BuildReport } from '@openref/static';
import { EXIT_CODE } from '../../src/cli/domain/exit-code.constants';
import type { CommandIo } from '../../src/cli/domain/command.types';

const MOCKS = fileURLToPath(new URL('../mocks/', import.meta.url));

function fakeIo(): CommandIo & { readonly out: string[]; readonly err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, stdout: (line) => out.push(line), stderr: (line) => err.push(line) };
}

let directory = '';

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'openref-cli-build-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('runBuild, its own arguments', () => {
  it('should fail with a usage error when no source is given', async () => {
    // Given
    const io = fakeIo();

    // When
    const outcome = await runBuild({ args: [], ...io });

    // Then
    expect(outcome.exitCode).toBe(EXIT_CODE.USAGE_ERROR);
    expect(io.err[0]).toContain('one of --spec, --config or --from-nest is required');
  });

  it('should fail with a usage error when more than one source is given', async () => {
    // Given
    const io = fakeIo();

    // When
    const outcome = await runBuild({
      args: ['--spec=a.json', '--from-nest=b.js'],
      ...io,
    });

    // Then
    expect(outcome.exitCode).toBe(EXIT_CODE.USAGE_ERROR);
    expect(io.err[0]).toContain('only one of');
  });

  it('should fail with a usage error when --out is missing, rather than picking a directory', async () => {
    // Given
    const io = fakeIo();
    const spec = resolve(MOCKS, 'mini-spec.json');

    // When
    const outcome = await runBuild({ args: [`--spec=${spec}`], ...io });

    // Then: SPEC 16.3 as amended by T039. A build has no defensible default directory, so the
    // absence is an error and never a guess about where files should go.
    expect(outcome.exitCode).toBe(EXIT_CODE.USAGE_ERROR);
    expect(io.err[0]).toContain('--out <dir> is required');
  });

  it('should refuse a --target it does not know, listing what it does', async () => {
    // Given
    const io = fakeIo();
    const spec = resolve(MOCKS, 'mini-spec.json');

    // When
    const outcome = await runBuild({
      args: [`--spec=${spec}`, `--out=${directory}`, '--target=heroku'],
      ...io,
    });

    // Then
    expect(outcome.exitCode).toBe(EXIT_CODE.USAGE_ERROR);
    expect(io.err[0]).toContain('"heroku"');
    expect(io.err[0]).toContain('netlify');
  });

  it('should refuse a bare --target with no value', async () => {
    // Given
    const io = fakeIo();
    const spec = resolve(MOCKS, 'mini-spec.json');

    // When
    const outcome = await runBuild({
      args: [`--spec=${spec}`, `--out=${directory}`, '--target'],
      ...io,
    });

    // Then
    expect(outcome.exitCode).toBe(EXIT_CODE.USAGE_ERROR);
    expect(io.err[0]).toContain('--target needs a value');
  });

  it('should print its usage and stop on --help', async () => {
    // Given
    const io = fakeIo();

    // When
    const outcome = await runBuild({ args: ['--help'], ...io });

    // Then
    expect(outcome.exitCode).toBe(EXIT_CODE.SUCCESS);
    expect(io.out[0]).toContain('Usage: openref build');
  });
});

describe('runBuild, the build it performs', () => {
  it('should write a page per node with its own address', async () => {
    // Given
    const io = fakeIo();
    const spec = resolve(MOCKS, 'mini-spec.json');

    // When
    const outcome = await runBuild({
      args: [`--spec=${spec}`, `--out=${directory}`, '--base=https://docs.example.com/api'],
      ...io,
    });

    // Then
    expect(outcome.exitCode).toBe(EXIT_CODE.SUCCESS);
    const page = await readFile(join(directory, 'get-ping', 'index.html'), 'utf8');
    expect(page).toContain('<!DOCTYPE html>');
    expect(page).toContain('<link rel="canonical" href="https://docs.example.com/api/get-ping">');
  });

  it('should report what it rendered and what it carried, separately', async () => {
    // Given
    const io = fakeIo();
    const spec = resolve(MOCKS, 'mini-spec.json');
    const args = [`--spec=${spec}`, `--out=${directory}`];
    await runBuild({ args, ...io });

    // When: the same document again, so every page is carried.
    const second = fakeIo();
    const outcome = await runBuild({ args, ...second });

    // Then
    expect(outcome.exitCode).toBe(EXIT_CODE.SUCCESS);
    expect(second.out.join('')).toContain('rendered  0');
    expect(second.out.join('')).toContain('carried   5');
  });

  it('should say removed 1 file in the singular, and files above one', () => {
    // Given a report shaped by hand, because the count is the whole subject.
    const report = (removed: readonly string[]): BuildReport => ({
      documentHash: 'abc',
      basePath: '',
      siteUrl: null,
      rendered: ['index.html'],
      carried: [],
      files: ['llms.txt'],
      removed,
      sitemap: false,
      notices: [],
      proxy: null,
    });

    // When
    const one = buildReportText(report(['stale/index.html']));
    const two = buildReportText(report(['stale/index.html', 'gone/index.html']));

    // Then
    expect(one).toContain('removed   1 file the last build wrote');
    expect(two).toContain('removed   2 files the last build wrote');
  });

  it('should say that no sitemap was written when the base carries no origin', async () => {
    // Given
    const io = fakeIo();
    const spec = resolve(MOCKS, 'mini-spec.json');

    // When
    const outcome = await runBuild({
      args: [`--spec=${spec}`, `--out=${directory}`, '--base=/docs'],
      ...io,
    });

    // Then
    expect(outcome.exitCode).toBe(EXIT_CODE.SUCCESS);
    expect(io.out.join('')).toContain('sitemap   not written');
    expect(io.out.join('')).toContain('Pass --base https://host/path');
  });

  it('should fail with a usage error when the document cannot be loaded', async () => {
    // Given
    const io = fakeIo();
    const spec = resolve(MOCKS, 'malformed-spec.json');

    // When
    const outcome = await runBuild({
      args: [`--spec=${spec}`, `--out=${directory}`],
      ...io,
    });

    // Then
    expect(outcome.exitCode).toBe(EXIT_CODE.USAGE_ERROR);
  });

  it('should fail with a usage error on a base that is neither a path nor a url', async () => {
    // Given
    const io = fakeIo();
    const spec = resolve(MOCKS, 'mini-spec.json');

    // When
    const outcome = await runBuild({
      args: [`--spec=${spec}`, `--out=${directory}`, '--base=docs.example.com'],
      ...io,
    });

    // Then
    expect(outcome.exitCode).toBe(EXIT_CODE.USAGE_ERROR);
    expect(io.err.join('')).toContain('--base must be');
  });
});

describe('runBuild, the --target of SPEC 16.2', () => {
  it('should generate the netlify rules for --target netlify and report them', async () => {
    // Given
    const io = fakeIo();
    const spec = resolve(MOCKS, 'proxy-spec.json');

    // When
    const outcome = await runBuild({
      args: [`--spec=${spec}`, `--out=${directory}`, '--target=netlify'],
      ...io,
    });

    // Then
    expect(outcome.exitCode).toBe(EXIT_CODE.SUCCESS);
    const redirects = await readFile(join(directory, '_redirects'), 'utf8');
    expect(redirects).toContain('/_proxy/u0/* https://api.example.com/v1/:splat 200');
    expect(io.out.join('')).toContain('proxy     netlify: 1 upstream, wrote _redirects');
  });

  it('should generate nothing without --target, and remove what a targeted build wrote', async () => {
    // Given: a targeted build first, so the absence below is the flag's doing and not the
    // document's, and so the stale removal of a dropped target is proven with it.
    const spec = resolve(MOCKS, 'proxy-spec.json');
    await runBuild({
      args: [`--spec=${spec}`, `--out=${directory}`, '--target=netlify'],
      ...fakeIo(),
    });
    expect(await readFile(join(directory, '_redirects'), 'utf8')).toContain(':splat 200');

    // When
    const io = fakeIo();
    const outcome = await runBuild({ args: [`--spec=${spec}`, `--out=${directory}`], ...io });

    // Then
    expect(outcome.exitCode).toBe(EXIT_CODE.SUCCESS);
    await expect(readFile(join(directory, '_redirects'), 'utf8')).rejects.toThrow();
    expect(io.out.join('')).not.toContain('proxy    ');
  });

  it('should detect the platform under --target auto from its environment variable', async () => {
    // Given
    const io = fakeIo();
    const spec = resolve(MOCKS, 'proxy-spec.json');

    // When
    const outcome = await runBuild({
      args: [`--spec=${spec}`, `--out=${directory}`, '--target=auto'],
      env: { NETLIFY: 'true' },
      ...io,
    });

    // Then
    expect(outcome.exitCode).toBe(EXIT_CODE.SUCCESS);
    const redirects = await readFile(join(directory, '_redirects'), 'utf8');
    expect(redirects).toContain(':splat 200');
  });

  it('should fall back to none with a warning when --target auto sees no platform', async () => {
    // Given
    const io = fakeIo();
    const spec = resolve(MOCKS, 'proxy-spec.json');

    // When
    const outcome = await runBuild({
      args: [`--spec=${spec}`, `--out=${directory}`, '--target=auto'],
      env: {},
      ...io,
    });

    // Then: the build proceeds, nothing is generated, and the warning says so.
    expect(outcome.exitCode).toBe(EXIT_CODE.SUCCESS);
    expect(io.err.join('')).toContain('none of NETLIFY, VERCEL or CF_PAGES');
    await expect(readFile(join(directory, '_redirects'), 'utf8')).rejects.toThrow();
  });

  it('should warn on the direct fallback of a target with no rewrite capability', async () => {
    // Given
    const io = fakeIo();
    const spec = resolve(MOCKS, 'proxy-spec.json');

    // When
    const outcome = await runBuild({
      args: [`--spec=${spec}`, `--out=${directory}`, '--target=github-pages'],
      ...io,
    });

    // Then: no file, the report line names the degradation, and the pages carry the warning.
    expect(outcome.exitCode).toBe(EXIT_CODE.SUCCESS);
    expect(io.out.join('')).toContain(
      'proxy     github-pages: no rewrite capability, pages carry the direct mode warning',
    );
    const bench = await readFile(join(directory, 'bench', 'get-ping', 'index.html'), 'utf8');
    expect(bench).toContain('published on GitHub Pages');
  });

  it('should land the bracketed function path on a real filesystem', async () => {
    // Given: the Pages Function file is named [[path]].js, and brackets in a directory entry
    // are the kind of thing a memory store cannot vouch for.
    const io = fakeIo();
    const spec = resolve(MOCKS, 'proxy-spec.json');

    // When
    const outcome = await runBuild({
      args: [`--spec=${spec}`, `--out=${directory}`, '--target=cloudflare-pages'],
      ...io,
    });

    // Then
    expect(outcome.exitCode).toBe(EXIT_CODE.SUCCESS);
    const written = await readFile(join(directory, 'functions', '_proxy', '[[path]].js'), 'utf8');
    expect(written).toContain('const UPSTREAMS = [');
    expect(written).toContain('"https://api.example.com/v1",');
  });
});
