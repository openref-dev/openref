import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runPr } from '../../src/cli/api/commands/pr.command';
import type { CommandContext } from '../../src/cli/domain/command.types';
import { EXIT_CODE } from '../../src/cli/domain/exit-code.constants';
import { PR_COMMENT_MARKER } from '../../src/cli/api/commands/pr-comment-text';
import {
  COMMENTS_PER_PAGE,
  MAX_COMMENT_PAGES,
} from '../../src/cli/infrastructure/adapters/github-comment.adapter';
import { FAKE_VIEWER, startFakeGitHub, type FakeGitHub } from '../mocks/fake-github';
import { SPAWNED_PROCESS_TIMEOUT_MS } from '../../../../vitest.spawn-timeout.ts';

/**
 * `openref pr` end to end: a real git repository for the base side, the working tree for the
 * head side, and a real socket for the GitHub API.
 *
 * THE THREE CASES T041 OWES ARE THE FIRST THREE: a pull request that adds an operation, one that
 * removes one, and one that changes one. They are one repository each rather than one shared
 * fixture, because the report they produce is the thing under test.
 */

const execFileAsync = promisify(execFile);

const BASE_SPEC = {
  openapi: '3.0.3',
  info: { title: 'Payments', version: '1.0.0' },
  paths: {
    '/payments/{id}': {
      get: {
        operationId: 'getPayment',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'ok',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Payment' } } },
          },
        },
      },
      delete: {
        operationId: 'deletePayment',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '204': { description: 'gone' } },
      },
    },
  },
  components: {
    schemas: {
      Payment: {
        type: 'object',
        required: ['id', 'amount'],
        properties: { id: { type: 'string' }, amount: { type: 'string' } },
      },
    },
  },
};

interface Repo {
  readonly dir: string;
  readonly restore: () => void;
}

async function makeRepo(head: unknown): Promise<Repo> {
  const dir = await mkdtemp(join(tmpdir(), 'openref-pr-'));
  const run = async (args: readonly string[]): Promise<void> => {
    await execFileAsync('git', [...args], { cwd: dir });
  };

  await run(['init', '-q', '-b', 'main']);
  await run(['config', 'user.email', 'test@example.test']);
  await run(['config', 'user.name', 'test']);
  await run(['config', 'commit.gpgsign', 'false']);
  await writeFile(join(dir, 'openapi.json'), JSON.stringify(BASE_SPEC, null, 2), 'utf8');
  await run(['add', 'openapi.json']);
  await run(['commit', '-q', '-m', 'base']);

  // The head side is the working tree, which is what `openref pr` compares against and what a
  // checkout in a workflow holds.
  await writeFile(join(dir, 'openapi.json'), JSON.stringify(head, null, 2), 'utf8');

  const previous = process.cwd();
  process.chdir(dir);
  return {
    dir,
    restore: () => {
      process.chdir(previous);
    },
  };
}

interface Run {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function runIn(
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): Promise<Run> {
  const out: string[] = [];
  const err: string[] = [];
  const context: CommandContext = {
    args,
    env,
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
  };
  const outcome = await runPr(context);
  return { exitCode: outcome.exitCode, stdout: out.join(''), stderr: err.join('') };
}

/** The base document with `DELETE /payments/{id}` gone, written out rather than deleted from. */
function withoutDeleteOperation(): unknown {
  const head = structuredClone(BASE_SPEC);
  return {
    ...head,
    paths: { '/payments/{id}': { get: head.paths['/payments/{id}'].get } },
  };
}

function eventPayload(options: { readonly fork: boolean; readonly number: number }): string {
  return JSON.stringify({
    pull_request: {
      number: options.number,
      base: { ref: 'main', sha: 'HEAD', repo: { full_name: 'acme/payments' } },
      head: {
        ref: 'topic',
        repo: { full_name: options.fork ? 'contributor/payments' : 'acme/payments' },
      },
    },
  });
}

describe('openref pr against a real repository', () => {
  let repo: Repo | undefined;
  let github: FakeGitHub | undefined;

  beforeEach(async () => {
    github = await startFakeGitHub();
  });

  afterEach(async () => {
    repo?.restore();
    if (repo !== undefined) await rm(repo.dir, { recursive: true, force: true });
    repo = undefined;
    await github?.close();
    github = undefined;
  });

  it(
    'should report an added operation as a non breaking change and exit 0',
    async () => {
      // Given a head that adds POST /payments/refund
      const head = structuredClone(BASE_SPEC) as typeof BASE_SPEC & {
        paths: Record<string, unknown>;
      };
      head.paths['/payments/refund'] = {
        post: { operationId: 'refund', responses: { '200': { description: 'ok' } } },
      };
      repo = await makeRepo(head);

      // When
      const run = await runIn(['--spec', 'openapi.json', '--base', 'HEAD', '--dry-run'], {});

      // Then
      expect(run.exitCode).toBe(EXIT_CODE.SUCCESS);
      expect(run.stdout).toContain('+ POST /payments/refund');
      expect(run.stdout).toContain('No breaking changes detected');
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it(
    'should report a removed operation as breaking, and exit 1 only when asked to',
    async () => {
      // Given a head with DELETE /payments/{id} gone
      repo = await makeRepo(withoutDeleteOperation());

      // When: without the flag, per SPEC 17.2, this always exits 0
      const reporting = await runIn(['--spec', 'openapi.json', '--base', 'HEAD', '--dry-run'], {});
      // And with it
      const gating = await runIn(
        ['--spec', 'openapi.json', '--base', 'HEAD', '--dry-run', '--fail-on-breaking'],
        {},
      );

      // Then
      expect(reporting.exitCode).toBe(EXIT_CODE.SUCCESS);
      expect(reporting.stdout).toContain('- DELETE /payments/{id}');
      expect(reporting.stdout).toContain('1 breaking change detected');
      expect(gating.exitCode).toBe(EXIT_CODE.FINDINGS);
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it(
    'should report a changed schema type in the block that is not the routes',
    async () => {
      // Given a head where Payment.amount became a number
      const head = structuredClone(BASE_SPEC);
      head.components.schemas.Payment.properties.amount = { type: 'number' };
      repo = await makeRepo(head);

      // When
      const run = await runIn(['--spec', 'openapi.json', '--base', 'HEAD', '--dry-run'], {});

      // Then
      expect(run.stdout).toContain('Schemas, security and servers:');
      expect(run.stdout).toContain('~ Payment.amount');
      expect(run.stdout).toContain('1 breaking change detected');
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it(
    'should create the comment once and update it in place on the next push',
    async () => {
      // Given a head that adds an operation, and a workflow environment with a token
      const head = structuredClone(BASE_SPEC) as typeof BASE_SPEC & {
        paths: Record<string, unknown>;
      };
      head.paths['/payments/refund'] = {
        post: { operationId: 'refund', responses: { '200': { description: 'ok' } } },
      };
      repo = await makeRepo(head);

      const eventPath = join(repo.dir, 'event.json');
      await writeFile(eventPath, eventPayload({ fork: false, number: 7 }), 'utf8');
      const outputPath = join(repo.dir, 'outputs.txt');
      const env = {
        GITHUB_EVENT_NAME: 'pull_request',
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_REPOSITORY: 'acme/payments',
        GITHUB_API_URL: github?.url ?? '',
        GITHUB_TOKEN: 'ghs-integration-secret',
        GITHUB_OUTPUT: outputPath,
      };

      // When: the same run twice, as two pushes to one pull request would
      const first = await runIn(['--spec', 'openapi.json', '--base', 'HEAD'], env);
      const second = await runIn(['--spec', 'openapi.json', '--base', 'HEAD'], env);

      // Then: one comment, created then updated
      expect(first.exitCode).toBe(EXIT_CODE.SUCCESS);
      expect(first.stdout).toContain('created the API review comment');
      expect(second.stdout).toContain('updated the API review comment');
      expect(github?.comments).toHaveLength(1);
      expect(github?.comments[0]?.body.split('\n')[0]).toBe(PR_COMMENT_MARKER);

      const methods = (github?.requests ?? []).map((request) => request.method);
      expect(methods).toContain('POST');
      expect(methods).toContain('PATCH');

      // And the token went out as a header and reached nothing else
      expect(github?.requests[0]?.authorization).toBe('Bearer ghs-integration-secret');
      expect(github?.comments[0]?.body).not.toContain('ghs-integration-secret');
      expect(await readFile(outputPath, 'utf8')).toContain('breaking-count=0');
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it(
    'should send no request at all from a fork, print the comment, and exit 0',
    async () => {
      // Given a fork pull request, where GITHUB_TOKEN is read only
      repo = await makeRepo(withoutDeleteOperation());

      const eventPath = join(repo.dir, 'event.json');
      await writeFile(eventPath, eventPayload({ fork: true, number: 9 }), 'utf8');
      const summaryPath = join(repo.dir, 'summary.md');
      await writeFile(summaryPath, '', 'utf8');

      // When
      const run = await runIn(['--spec', 'openapi.json', '--base', 'HEAD'], {
        GITHUB_EVENT_NAME: 'pull_request',
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_REPOSITORY: 'acme/payments',
        GITHUB_API_URL: github?.url ?? '',
        GITHUB_TOKEN: 'ghs-read-only',
        GITHUB_STEP_SUMMARY: summaryPath,
      });

      // Then: the fake proves it can see traffic in the case above, and saw none here
      expect(run.exitCode).toBe(EXIT_CODE.SUCCESS);
      expect(github?.requests).toEqual([]);
      expect(run.stderr).toContain('fork');
      expect(run.stdout).toContain('- DELETE /payments/{id}');

      // And the report reached the reader by the one channel a fork run has
      const summary = await readFile(summaryPath, 'utf8');
      expect(summary).toContain(PR_COMMENT_MARKER);
      expect(summary).not.toContain('ghs-read-only');
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it(
    'should fail as a usage error when the base ref is not in the repository',
    async () => {
      // Given
      repo = await makeRepo(BASE_SPEC);

      // When
      const run = await runIn(['--spec', 'openapi.json', '--base', 'no-such-ref', '--dry-run'], {});

      // Then
      expect(run.exitCode).toBe(EXIT_CODE.USAGE_ERROR);
      expect(run.stderr).toContain('could not read openapi.json at git ref no-such-ref');
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it(
    'should build the preview under a base derived from the pull request number',
    async () => {
      // Given
      repo = await makeRepo(BASE_SPEC);
      const eventPath = join(repo.dir, 'event.json');
      await writeFile(eventPath, eventPayload({ fork: false, number: 12 }), 'utf8');
      const out = join(repo.dir, 'preview');

      // When
      const run = await runIn(
        [
          '--spec',
          'openapi.json',
          '--base',
          'HEAD',
          '--dry-run',
          '--out',
          out,
          '--preview-base',
          'https://docs.example.test/previews',
        ],
        // The token is in the environment of this run, which is what makes the absence below a
        // finding rather than a tautology, per SPEC 17.2 and SPEC 19.7.
        { GITHUB_EVENT_PATH: eventPath, GITHUB_TOKEN: 'ghs-preview-secret' },
      );

      // Then
      expect(run.exitCode).toBe(EXIT_CODE.SUCCESS);
      expect(run.stdout).toContain('Preview: https://docs.example.test/previews/pr-12');

      // And every link in what was built carries the same derived base
      const page = await readFile(join(out, 'index.html'), 'utf8');
      expect(page).toContain('/previews/pr-12/');

      // And no file the build wrote carries the credential the run held. The walker is shown
      // reading real content first, so an empty read cannot pass for a clean result.
      const written = await readEveryFile(out);
      expect(written.join('\n')).toContain('Payments');
      expect(written.filter((text) => text.includes('ghs-preview-secret'))).toEqual([]);
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );
});

/**
 * The repository half of the API address, measured against the fake with a write token set.
 *
 * EVERY SPELLING HERE WAS MEASURED SENDING A REQUEST BEFORE THE PARSE EXISTED. `../../escaped`
 * produced `GET /escaped/issues/5/comments`, `a/b/../../../evil` produced `/evil/...`, and
 * `%2e%2e/%2e%2e/x` produced `/x/...`, each carrying the token. The assertion below is that the
 * fake, which the case above proves can see traffic, sees none at all.
 */
const HOSTILE_REPOSITORIES: readonly string[] = [
  '../../escaped',
  'a/b/../../../evil',
  '%2e%2e/%2e%2e/x',
  '%2E%2E/%2E%2E/X',
  'acme%2Fpayments',
  'ACME%2Fpayments',
  'acme/..',
  'acme/payments:x',
  'acme\\payments',
  'https://evil.test/acme/payments',
  'acme/payments/extra',
  'acme',
];

describe('the repository the comment is addressed to', () => {
  let repo: Repo | undefined;
  let github: FakeGitHub | undefined;

  beforeEach(async () => {
    github = await startFakeGitHub();
  });

  afterEach(async () => {
    repo?.restore();
    if (repo !== undefined) await rm(repo.dir, { recursive: true, force: true });
    repo = undefined;
    await github?.close();
    github = undefined;
  });

  it(
    'should reach exactly /repos/<owner>/<name>/issues/<n>/comments for a legal value',
    async () => {
      // Given: presence first, so the refusals below are a finding rather than a tautology
      repo = await makeRepo(withoutDeleteOperation());
      const eventPath = join(repo.dir, 'event.json');
      await writeFile(eventPath, eventPayload({ fork: false, number: 5 }), 'utf8');

      // When
      const run = await runIn(['--spec', 'openapi.json', '--base', 'HEAD'], {
        GITHUB_EVENT_NAME: 'pull_request',
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_API_URL: github?.url ?? '',
        GITHUB_TOKEN: 'ghs-write-token',
        OPENREF_PR_REPOSITORY: 'Acme-Corp/pay.ments_v2',
      });

      // Then
      expect(run.exitCode).toBe(EXIT_CODE.SUCCESS);
      const posted = (github?.requests ?? []).find((request) => request.method === 'POST');
      expect(posted?.url).toBe('/repos/Acme-Corp/pay.ments_v2/issues/5/comments');
      expect(posted?.authorization).toBe('Bearer ghs-write-token');
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it.each(HOSTILE_REPOSITORIES)(
    'should refuse %j before forming a request, sending none at all',
    async (value) => {
      // Given a run that would otherwise post: a write token, an event, and an API root
      repo = await makeRepo(withoutDeleteOperation());
      const eventPath = join(repo.dir, 'event.json');
      await writeFile(eventPath, eventPayload({ fork: false, number: 5 }), 'utf8');

      // When
      const run = await runIn(['--spec', 'openapi.json', '--base', 'HEAD'], {
        GITHUB_EVENT_NAME: 'pull_request',
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_API_URL: github?.url ?? '',
        GITHUB_TOKEN: 'ghs-write-token',
        OPENREF_PR_REPOSITORY: value,
      });

      // Then
      expect(run.exitCode).toBe(EXIT_CODE.USAGE_ERROR);
      expect(run.stderr).toContain('exactly owner/name');
      expect(github?.requests).toEqual([]);
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it(
    'should refuse the same spellings given as a flag, which is the other way in',
    async () => {
      // Given
      repo = await makeRepo(withoutDeleteOperation());

      // When
      const run = await runIn(
        ['--spec', 'openapi.json', '--base', 'HEAD', '--repository', '../../escaped'],
        { GITHUB_API_URL: github?.url ?? '', GITHUB_TOKEN: 'ghs-write-token' },
      );

      // Then
      expect(run.exitCode).toBe(EXIT_CODE.USAGE_ERROR);
      expect(github?.requests).toEqual([]);
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it.each(PADDING)(
    'should refuse a repository padded with %s on both ways in, sending nothing',
    async (_name, character) => {
      // Given: SPEC 19.11 says this value is refused rather than repaired, and the environment
      // path repaired it. Measured before this change, a tabbed value arrived here trimmed
      // and posted a comment; the flag path refused the identical string.
      repo = await makeRepo(withoutDeleteOperation());
      const eventPath = join(repo.dir, 'event.json');
      await writeFile(eventPath, eventPayload({ fork: false, number: 5 }), 'utf8');
      const padded = `${character}acme/payments${character}`;
      const base = {
        GITHUB_EVENT_NAME: 'pull_request',
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_API_URL: github?.url ?? '',
        GITHUB_TOKEN: 'ghs-write-token',
      };

      // When
      const byVariable = await runIn(['--spec', 'openapi.json', '--base', 'HEAD'], {
        ...base,
        OPENREF_PR_REPOSITORY: padded,
      });
      const byFlag = await runIn(
        ['--spec', 'openapi.json', '--base', 'HEAD', '--repository', padded],
        base,
      );

      // Then: the fake, which the case above proves can see traffic, saw none from either
      expect(byVariable.exitCode).toBe(EXIT_CODE.USAGE_ERROR);
      expect(byFlag.exitCode).toBe(EXIT_CODE.USAGE_ERROR);
      expect(byVariable.stderr).toContain('exactly owner/name');
      expect(byFlag.stderr).toContain('exactly owner/name');
      expect(github?.requests).toEqual([]);
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );
});

/**
 * Every whitespace and control character the review named, by code point rather than typed.
 *
 * A tab and four spaces look the same in a source file, and a non breaking space looks like a
 * space, so a case written with the character itself would prove whatever the editor saved.
 */
const PADDING: readonly (readonly [string, string])[] = [
  ['SP', '\u0020'],
  ['TAB', '\u0009'],
  ['CR', '\u000d'],
  ['LF', '\u000a'],
  ['VT', '\u000b'],
  ['FF', '\u000c'],
  ['NBSP', '\u00a0'],
];

/**
 * `GITHUB_API_URL`, which named the host every token bearing request was sent to and was checked
 * by nothing at all.
 *
 * WHAT THIS SUITE CAN AND CANNOT SHOW. It can show that the loopback fake is reached, which is the
 * presence half, and that each hostile root produces no request on that socket at all. It cannot
 * show a request arriving at a real https server: there is none in this repository, and standing
 * one up would mean a certificate this suite would have to tell Node to ignore, which is a weaker
 * proof than the parse. That an https root is accepted and turned into the right address is proved
 * in `packages/cli/test/unit/api-origin.spec.ts` and in the adapter's own suite, every case of
 * which speaks to `https://api.example.test`.
 */
const HOSTILE_API_ROOTS: readonly (readonly [string, string])[] = [
  ['http://evil.test', 'plain http off this machine, where the token is readable on the wire'],
  ['http://198.51.100.7:8080', 'plain http to an address that is not loopback'],
  ['ftp://api.github.com', 'a scheme that is not http at all'],
  ['file:///etc/passwd', 'a scheme with no host'],
  ['javascript:fetch(1)', 'a scheme that is not a transport'],
  ['api.github.com', 'a bare host with no scheme'],
  ['https://', 'an https looking string that is not a URL'],
  ['https://exa mple.com', 'an https looking string with a space in the host'],
  ['https://someone:else@api.github.com', 'credentials smuggled into the address'],
];

describe('the API root the token is sent to', () => {
  let repo: Repo | undefined;
  let github: FakeGitHub | undefined;

  beforeEach(async () => {
    github = await startFakeGitHub();
  });

  afterEach(async () => {
    repo?.restore();
    if (repo !== undefined) await rm(repo.dir, { recursive: true, force: true });
    repo = undefined;
    await github?.close();
    github = undefined;
  });

  /** The environment of a run allowed to post, against one API root. */
  async function postingEnvironment(
    api: string,
  ): Promise<Readonly<Record<string, string | undefined>>> {
    const current = repo;
    if (current === undefined) throw new Error('no repository');
    const eventPath = join(current.dir, 'event.json');
    await writeFile(eventPath, eventPayload({ fork: false, number: 5 }), 'utf8');
    return {
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_REPOSITORY: 'acme/payments',
      GITHUB_API_URL: api,
      GITHUB_TOKEN: 'ghs-write-token',
    };
  }

  it(
    'should reach a loopback root over http, which is where the fake listens',
    async () => {
      // Given: presence first, so every refusal below is a finding rather than a parser that says
      // no to everything and breaks the action on the day it runs
      repo = await makeRepo(withoutDeleteOperation());
      const env = await postingEnvironment(github?.url ?? '');

      // When
      const run = await runIn(['--spec', 'openapi.json', '--base', 'HEAD'], env);

      // Then
      expect(run.exitCode).toBe(EXIT_CODE.SUCCESS);
      expect((github?.requests ?? []).map((request) => request.method)).toContain('POST');
      expect(github?.requests[0]?.authorization).toBe('Bearer ghs-write-token');
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it(
    'should reach the same fake spelled localhost, which is the other way a person writes it',
    async () => {
      // Given
      repo = await makeRepo(withoutDeleteOperation());
      const port = new URL(github?.url ?? 'http://127.0.0.1:0').port;
      const env = await postingEnvironment(`http://localhost:${port}`);

      // When
      const run = await runIn(['--spec', 'openapi.json', '--base', 'HEAD'], env);

      // Then
      expect(run.exitCode).toBe(EXIT_CODE.SUCCESS);
      expect((github?.requests ?? []).map((request) => request.method)).toContain('POST');
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it.each(HOSTILE_API_ROOTS)(
    'should refuse %j, which is %s, before forming a request',
    async (root) => {
      // Given a run that would otherwise post: a write token, an event and a legal repository
      repo = await makeRepo(withoutDeleteOperation());
      const env = await postingEnvironment(root);

      // When
      const run = await runIn(['--spec', 'openapi.json', '--base', 'HEAD'], env);

      // Then
      expect(run.exitCode).toBe(EXIT_CODE.USAGE_ERROR);
      expect(run.stderr).toContain('GITHUB_API_URL');
      expect(github?.requests).toEqual([]);
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );
});

describe('whose comment may be overwritten', () => {
  let repo: Repo | undefined;
  let github: FakeGitHub | undefined;

  afterEach(async () => {
    repo?.restore();
    if (repo !== undefined) await rm(repo.dir, { recursive: true, force: true });
    repo = undefined;
    await github?.close();
    github = undefined;
  });

  /** The environment of a run that is allowed to post. */
  async function postingEnvironment(
    api: string,
  ): Promise<Readonly<Record<string, string | undefined>>> {
    const current = repo;
    if (current === undefined) throw new Error('no repository');
    const eventPath = join(current.dir, 'event.json');
    await writeFile(eventPath, eventPayload({ fork: false, number: 7 }), 'utf8');
    return {
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_REPOSITORY: 'acme/payments',
      GITHUB_API_URL: api,
      GITHUB_TOKEN: 'ghs-write-token',
    };
  }

  it(
    'should adopt and patch the comment its own identity wrote',
    async () => {
      // Given a comment already on the thread, authored by the identity the token resolves to
      github = await startFakeGitHub();
      repo = await makeRepo(withoutDeleteOperation());
      const seeded = github.seed({ body: `${PR_COMMENT_MARKER}\nolder body`, author: FAKE_VIEWER });
      const env = await postingEnvironment(github.url);

      // When
      const run = await runIn(['--spec', 'openapi.json', '--base', 'HEAD'], env);

      // Then
      expect(run.exitCode).toBe(EXIT_CODE.SUCCESS);
      expect(run.stdout).toContain('updated the API review comment');
      expect(github.comments).toHaveLength(1);
      expect(github.comments[0]?.id).toBe(seeded);
      expect(github.requests.map((request) => request.method)).toContain('PATCH');
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it(
    'should leave a contributor comment alone even when its first line is the marker',
    async () => {
      // Given a contributor who wrote the marker as their whole first line. Measured before the
      // author check existed, this comment was adopted and overwritten by the run below.
      github = await startFakeGitHub();
      repo = await makeRepo(withoutDeleteOperation());
      const theirs = github.seed({
        body: `${PR_COMMENT_MARKER}\nplease do not overwrite me`,
        author: 'contributor',
      });
      const env = await postingEnvironment(github.url);

      // When
      const run = await runIn(['--spec', 'openapi.json', '--base', 'HEAD'], env);

      // Then: theirs is untouched, ours is new, and no PATCH was sent at all
      expect(run.exitCode).toBe(EXIT_CODE.SUCCESS);
      expect(run.stdout).toContain('created the API review comment');
      expect(github.comments).toHaveLength(2);
      expect(github.comments.find((comment) => comment.id === theirs)?.body).toContain(
        'please do not overwrite me',
      );
      expect(github.requests.map((request) => request.method)).not.toContain('PATCH');
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it(
    'should keep one comment under an installation token, by the app it acted as',
    async () => {
      // Given a fake that refuses `GET /user` the way GitHub refuses it for an installation token,
      // and attributes what it writes the way GitHub attributes an app's comment
      github = await startFakeGitHub({ identity: 'refused' });
      repo = await makeRepo(withoutDeleteOperation());
      const env = await postingEnvironment(github.url);

      // When: two pushes to the same pull request
      const first = await runIn(['--spec', 'openapi.json', '--base', 'HEAD'], env);
      const second = await runIn(['--spec', 'openapi.json', '--base', 'HEAD'], env);

      // Then: one comment, created then updated, which is the SPEC 17.2 promise under the token
      // the action ships with
      expect(first.stdout).toContain('created the API review comment');
      expect(second.stdout).toContain('updated the API review comment');
      expect(github.comments).toHaveLength(1);
      expect(github.requests.map((request) => request.method)).toContain('PATCH');
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it.each([
    ['a contributor', { author: 'contributor' }],
    ['another app', { author: 'dependabot[bot]', authorType: 'Bot', appSlug: 'dependabot' }],
    ['a bot with no app field', { author: 'someone[bot]', authorType: 'Bot' }],
  ])(
    'should not adopt a marked comment from %s under an installation token',
    async (_label, author) => {
      // Given
      github = await startFakeGitHub({ identity: 'refused' });
      repo = await makeRepo(withoutDeleteOperation());
      const theirs = github.seed({ body: `${PR_COMMENT_MARKER}\ntheirs`, ...author });
      const env = await postingEnvironment(github.url);

      // When
      const run = await runIn(['--spec', 'openapi.json', '--base', 'HEAD'], env);

      // Then
      expect(run.stdout).toContain('created the API review comment');
      expect(github.comments).toHaveLength(2);
      expect(github.comments.find((one) => one.id === theirs)?.body).toContain('theirs');
      expect(github.requests.map((request) => request.method)).not.toContain('PATCH');
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it(
    'should post and say so when neither identity path answers',
    async () => {
      // Given a fake whose identity answer carries no login and is not the 403 that classifies an
      // installation token
      github = await startFakeGitHub({ identity: 'unreadable' });
      repo = await makeRepo(withoutDeleteOperation());
      const env = await postingEnvironment(github.url);

      // When: two pushes to the same pull request
      const first = await runIn(['--spec', 'openapi.json', '--base', 'HEAD'], env);
      const second = await runIn(['--spec', 'openapi.json', '--base', 'HEAD'], env);

      // Then: never a PATCH, and the reason is on stderr rather than left to be guessed
      expect(first.exitCode).toBe(EXIT_CODE.SUCCESS);
      expect(second.exitCode).toBe(EXIT_CODE.SUCCESS);
      expect(github.requests.map((request) => request.method)).not.toContain('PATCH');
      expect(github.comments).toHaveLength(2);
      expect(second.stderr).toContain('would not say which identity');
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );
});

describe('a fork status this run cannot establish', () => {
  let repo: Repo | undefined;
  let github: FakeGitHub | undefined;

  beforeEach(async () => {
    github = await startFakeGitHub();
  });

  afterEach(async () => {
    repo?.restore();
    if (repo !== undefined) await rm(repo.dir, { recursive: true, force: true });
    repo = undefined;
    await github?.close();
    github = undefined;
  });

  it(
    'should refuse with exit 2 when the named event payload cannot be read',
    async () => {
      // Given a workflow environment whose payload is not there, and a write token
      repo = await makeRepo(withoutDeleteOperation());

      // When
      const run = await runIn(['--spec', 'openapi.json', '--base', 'HEAD'], {
        GITHUB_EVENT_NAME: 'pull_request',
        GITHUB_EVENT_PATH: join(repo.dir, 'no-such-event.json'),
        GITHUB_REPOSITORY: 'acme/payments',
        GITHUB_API_URL: github?.url ?? '',
        GITHUB_TOKEN: 'ghs-write-token',
      });

      // Then
      expect(run.exitCode).toBe(EXIT_CODE.USAGE_ERROR);
      expect(run.stderr).toContain('could not be read');
      expect(run.stderr).toContain('comes from a fork cannot be established');
      expect(github?.requests).toEqual([]);
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it(
    'should still refuse when the number and repository were supplied by flags',
    async () => {
      // Given: this is the case the old wiring let through. The run had everything it needed to
      // address a request and nothing at all about where the head came from.
      repo = await makeRepo(withoutDeleteOperation());
      const payload = join(repo.dir, 'event.json');
      await writeFile(payload, '{ this is not json', 'utf8');

      // When
      const run = await runIn(
        [
          '--spec',
          'openapi.json',
          '--base',
          'HEAD',
          '--repository',
          'acme/payments',
          '--pull-request',
          '5',
        ],
        {
          GITHUB_EVENT_NAME: 'pull_request',
          GITHUB_EVENT_PATH: payload,
          GITHUB_API_URL: github?.url ?? '',
          GITHUB_TOKEN: 'ghs-write-token',
        },
      );

      // Then
      expect(run.exitCode).toBe(EXIT_CODE.USAGE_ERROR);
      expect(github?.requests).toEqual([]);
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it(
    'should print and exit 0 on a dry run, since a dry run posts nothing anyway',
    async () => {
      // Given: refusing here would turn a report into a red pull request for no gain
      repo = await makeRepo(withoutDeleteOperation());

      // When
      const run = await runIn(['--spec', 'openapi.json', '--base', 'HEAD', '--dry-run'], {
        GITHUB_EVENT_NAME: 'pull_request',
        GITHUB_EVENT_PATH: join(repo.dir, 'no-such-event.json'),
        GITHUB_API_URL: github?.url ?? '',
        GITHUB_TOKEN: 'ghs-write-token',
      });

      // Then
      expect(run.exitCode).toBe(EXIT_CODE.SUCCESS);
      expect(run.stdout).toContain(PR_COMMENT_MARKER);
      expect(github?.requests).toEqual([]);
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );
});

describe('the step outputs a workflow reads', () => {
  let repo: Repo | undefined;

  afterEach(async () => {
    repo?.restore();
    if (repo !== undefined) await rm(repo.dir, { recursive: true, force: true });
    repo = undefined;
  });

  it(
    'should write one line per output, which is the shape the reader parses',
    async () => {
      // Given: presence first, because the case below is about a line that must be missing
      repo = await makeRepo(withoutDeleteOperation());
      const outputPath = join(repo.dir, 'outputs.txt');

      // When
      const run = await runIn(
        [
          '--spec',
          'openapi.json',
          '--base',
          'HEAD',
          '--dry-run',
          '--preview-url',
          'https://docs.example.test/pr-1',
        ],
        { GITHUB_OUTPUT: outputPath },
      );

      // Then
      expect(run.exitCode).toBe(EXIT_CODE.SUCCESS);
      const lines = (await readFile(outputPath, 'utf8')).trimEnd().split('\n');
      expect(lines).toEqual([
        'breaking-count=1',
        'change-count=1',
        'preview-url=https://docs.example.test/pr-1',
        'comment-url=',
      ]);
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it(
    'should withhold an output whose value carries a newline, and say so',
    async () => {
      // Given: `name=value` on its own line is the whole format, so a newline inside a value is how
      // a step writes a second output nobody declared. `openref pr` builds all four values itself
      // today, but `--preview-url` is printed exactly as the caller gave it, so the caller supplies
      // the newline. THIS GUARD HAD NO TEST: deleting it left the whole suite green.
      repo = await makeRepo(withoutDeleteOperation());
      const outputPath = join(repo.dir, 'outputs.txt');
      const injected = 'https://docs.example.test/pr-1\nOPENREF_INJECTED=yes';

      // When
      const run = await runIn(
        ['--spec', 'openapi.json', '--base', 'HEAD', '--dry-run', '--preview-url', injected],
        { GITHUB_OUTPUT: outputPath },
      );

      // Then: the output is withheld rather than written, and the reason reaches stderr
      expect(run.exitCode).toBe(EXIT_CODE.SUCCESS);
      expect(run.stderr).toContain('the preview-url output holds a newline and was not written');

      // And nothing the caller wrote became a second line of the file
      const written = await readFile(outputPath, 'utf8');
      expect(written).not.toContain('OPENREF_INJECTED');
      expect(written.trimEnd().split('\n')).toEqual([
        'breaking-count=1',
        'change-count=1',
        'comment-url=',
      ]);
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it(
    'should withhold it the same way when the value arrived by the environment',
    async () => {
      // Given: the action passes every option this way, so the guard has to hold on that path too
      repo = await makeRepo(withoutDeleteOperation());
      const outputPath = join(repo.dir, 'outputs.txt');

      // When
      const run = await runIn(['--spec', 'openapi.json', '--base', 'HEAD', '--dry-run'], {
        GITHUB_OUTPUT: outputPath,
        OPENREF_PR_PREVIEW_URL: 'https://docs.example.test/a\nOPENREF_INJECTED=yes',
      });

      // Then
      expect(run.stderr).toContain('holds a newline and was not written');
      expect(await readFile(outputPath, 'utf8')).not.toContain('OPENREF_INJECTED');
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );
});

describe('a redirect answered to a request carrying the token', () => {
  let repo: Repo | undefined;
  let github: FakeGitHub | undefined;
  let elsewhere: FakeGitHub | undefined;

  afterEach(async () => {
    repo?.restore();
    if (repo !== undefined) await rm(repo.dir, { recursive: true, force: true });
    repo = undefined;
    await github?.close();
    await elsewhere?.close();
    github = undefined;
    elsewhere = undefined;
  });

  /** The environment of a run that is allowed to post, against one API root. */
  async function postingEnvironment(
    api: string,
  ): Promise<Readonly<Record<string, string | undefined>>> {
    const current = repo;
    if (current === undefined) throw new Error('no repository');
    const eventPath = join(current.dir, 'event.json');
    await writeFile(eventPath, eventPayload({ fork: false, number: 5 }), 'utf8');
    return {
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_REPOSITORY: 'acme/payments',
      GITHUB_API_URL: api,
      GITHUB_TOKEN: 'ghs-write-token',
    };
  }

  it(
    'should flow normally against a server that answers rather than redirects',
    async () => {
      // Given: presence first. Without this the two refusals below would pass against a client that
      // could not talk to this fake at all.
      github = await startFakeGitHub();
      repo = await makeRepo(withoutDeleteOperation());
      const env = await postingEnvironment(github.url);

      // When
      const run = await runIn(['--spec', 'openapi.json', '--base', 'HEAD'], env);

      // Then: the run posts, and the recorder saw the credential on the wire, which is what makes
      // "the token was never sent onward" a fact about this path rather than about an idle socket
      expect(run.exitCode).toBe(EXIT_CODE.SUCCESS);
      expect(github.requests[0]?.authorization).toBe('Bearer ghs-write-token');
      expect(github.requests.map((request) => request.method)).toContain('POST');
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it(
    'should refuse a same origin redirect, which is the one that keeps the header',
    async () => {
      // Given a server that answers every request with a 302 to a path on itself. This is the case
      // undici's cross origin stripping does not cover: the header survives, and the token would be
      // delivered to a path this tool never constructed.
      github = await startFakeGitHub({ redirectTo: '/repos/somebody/else/issues/1/comments' });
      repo = await makeRepo(withoutDeleteOperation());
      const env = await postingEnvironment(github.url);

      // When
      const run = await runIn(['--spec', 'openapi.json', '--base', 'HEAD'], env);

      // Then: refused, said out loud, and exactly one request ever left
      expect(run.exitCode).toBe(EXIT_CODE.USAGE_ERROR);
      expect(run.stderr).toContain('redirect');
      expect(run.stderr).toContain('/repos/somebody/else/issues/1/comments');
      expect(github.requests).toHaveLength(1);
      expect(github.comments).toEqual([]);
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it(
    'should refuse a cross origin redirect too, and reach the other origin not at all',
    async () => {
      // Given a second server on another origin, and a first that points every request at it
      elsewhere = await startFakeGitHub();
      github = await startFakeGitHub({
        redirectTo: `${elsewhere.url}/repos/a/b/issues/1/comments`,
      });
      repo = await makeRepo(withoutDeleteOperation());
      const env = await postingEnvironment(github.url);

      // When
      const run = await runIn(['--spec', 'openapi.json', '--base', 'HEAD'], env);

      // Then: the second origin is a recorder that the case above proves can see traffic, and it
      // saw none. Node would have stripped the credential on the way; nothing here relies on that.
      expect(run.exitCode).toBe(EXIT_CODE.USAGE_ERROR);
      expect(run.stderr).toContain('redirect');
      expect(github.requests).toHaveLength(1);
      expect(elsewhere.requests).toEqual([]);
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );
});

describe('a thread longer than the search is allowed to read', () => {
  let repo: Repo | undefined;
  let github: FakeGitHub | undefined;

  afterEach(async () => {
    repo?.restore();
    if (repo !== undefined) await rm(repo.dir, { recursive: true, force: true });
    repo = undefined;
    await github?.close();
    github = undefined;
  });

  it(
    'should say the cap was reached rather than post a second comment in silence',
    async () => {
      // Given a pull request carrying more comments than the search reads, none of them ours. Past
      // that cap this run cannot find its own comment even if one is there, so every push adds
      // another one; the point of this case is that the duplicate is explained rather than
      // mysterious.
      github = await startFakeGitHub();
      repo = await makeRepo(withoutDeleteOperation());
      for (let index = 0; index < MAX_COMMENT_PAGES * COMMENTS_PER_PAGE; index++) {
        github.seed({ body: `noise ${String(index)}`, author: 'contributor' });
      }
      const eventPath = join(repo.dir, 'event.json');
      await writeFile(eventPath, eventPayload({ fork: false, number: 5 }), 'utf8');

      // When
      const run = await runIn(['--spec', 'openapi.json', '--base', 'HEAD'], {
        GITHUB_EVENT_NAME: 'pull_request',
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_REPOSITORY: 'acme/payments',
        GITHUB_API_URL: github.url,
        GITHUB_TOKEN: 'ghs-write-token',
      });

      // Then
      expect(run.exitCode).toBe(EXIT_CODE.SUCCESS);
      expect(run.stdout).toContain('created the API review comment');
      expect(run.stderr).toContain(`cap of ${String(MAX_COMMENT_PAGES)} pages`);
      expect(run.stderr).toContain(String(MAX_COMMENT_PAGES * COMMENTS_PER_PAGE));
      expect(github.requests.filter((request) => request.method === 'GET')).toHaveLength(
        MAX_COMMENT_PAGES + 1,
      );
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it(
    'should say nothing about a cap on a thread that simply ended',
    async () => {
      // Given: a sentence printed on every ordinary run is a sentence nobody reads
      github = await startFakeGitHub();
      repo = await makeRepo(withoutDeleteOperation());
      const eventPath = join(repo.dir, 'event.json');
      await writeFile(eventPath, eventPayload({ fork: false, number: 5 }), 'utf8');

      // When
      const run = await runIn(['--spec', 'openapi.json', '--base', 'HEAD'], {
        GITHUB_EVENT_NAME: 'pull_request',
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_REPOSITORY: 'acme/payments',
        GITHUB_API_URL: github.url,
        GITHUB_TOKEN: 'ghs-write-token',
      });

      // Then
      expect(run.stderr).not.toContain('cap of');
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );
});

/** The text of every file under a directory, walked rather than listed. */
async function readEveryFile(directory: string): Promise<string[]> {
  const contents: string[] = [];

  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      contents.push(...(await readEveryFile(path)));
    } else {
      contents.push(await readFile(path, 'utf8'));
    }
  }

  return contents;
}
