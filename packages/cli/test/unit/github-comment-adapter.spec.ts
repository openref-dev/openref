import { describe, expect, it } from 'vitest';
import { parseApiOrigin, type ApiOrigin } from '../../src/cli/domain/api-origin';
import { parseRepositorySlug, type RepositorySlug } from '../../src/cli/domain/repository-slug';
import {
  ACTIONS_APP_SLUG,
  carriesMarker,
  COMMENTS_PER_PAGE,
  findMarkedComment,
  MAX_COMMENT_PAGES,
  parseComments,
  resolveIdentity,
  upsertMarkedComment,
  writtenBy,
  type FetchLike,
  type GitHubCommentTarget,
} from '../../src/cli/infrastructure/adapters/github-comment.adapter';

const MARKER = '<!-- openref:api-review -->';

/** The identity every case below authenticates as, unless it says otherwise. */
const VIEWER = 'openref-bot';

function slug(value: string): RepositorySlug {
  const parsed = parseRepositorySlug(value);
  if ('usageError' in parsed) throw new Error(parsed.usageError);
  return parsed;
}

/**
 * The API root, obtained the only way one can be: through the parse.
 *
 * THIS IS PRESENCE FIRST FOR SPEC 19.11's HTTPS RULE. Every case in this file speaks to a legal
 * https origin, and each asserts the address the request went to, so the refusals in
 * `api-origin.spec.ts` and in the integration suite are findings rather than a parser that says no
 * to everything.
 */
function origin(value: string): ApiOrigin {
  const parsed = parseApiOrigin(value);
  if ('usageError' in parsed) throw new Error(parsed.usageError);
  return parsed;
}

const TARGET: GitHubCommentTarget = {
  apiOrigin: origin('https://api.example.test'),
  repository: slug('acme/api'),
  pullRequest: 7,
  token: 'ghs-secret-value',
};

interface Call {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string | undefined;
}

function recorder(responder: (call: Call) => { status?: number; body: string }): {
  readonly calls: Call[];
  readonly fetch: FetchLike;
} {
  const calls: Call[] = [];
  const fetch: FetchLike = (url, init) => {
    const call: Call = {
      url,
      method: init?.method ?? 'GET',
      headers: init?.headers ?? {},
      body: init?.body,
    };
    calls.push(call);
    const answer = responder(call);
    const status = answer.status ?? 200;
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      text: () => Promise.resolve(answer.body),
    });
  };
  return { calls, fetch };
}

/** A responder that answers the identity request and hands everything else on. */
function withIdentity(
  login: string | { readonly status: number },
  rest: (call: Call) => { status?: number; body: string },
): (call: Call) => { status?: number; body: string } {
  return (call) => {
    if (call.url.endsWith('/user')) {
      return typeof login === 'string'
        ? { body: JSON.stringify({ login }) }
        : { status: login.status, body: '{"message":"Resource not accessible by integration"}' };
    }
    return rest(call);
  };
}

/** One listing entry, as GitHub returns it for a person. */
function comment(id: number, body: string, author: string): unknown {
  return { id, body, user: { login: author, type: 'User' } };
}

/** One listing entry as GitHub returns it for an app's installation. */
function botComment(id: number, body: string, slug: string | undefined): unknown {
  return {
    id,
    body,
    user: { login: 'github-actions[bot]', type: 'Bot' },
    ...(slug === undefined ? {} : { performed_via_github_app: { slug } }),
  };
}

describe('resolveIdentity', () => {
  it('should read the login a user token authenticates as', async () => {
    // Given
    const { calls, fetch } = recorder(() => ({ body: JSON.stringify({ login: VIEWER }) }));

    // When
    const identity = await resolveIdentity(TARGET, fetch);

    // Then
    expect(identity).toEqual({ kind: 'user', login: VIEWER });
    expect(calls[0]?.url).toBe('https://api.example.test/user');
  });

  it('should read a 403 as the installation token it classifies, not as a failure', async () => {
    // Given: GitHub refuses this endpoint for a GitHub App installation token, so the refusal is
    // what says which of the two kinds of token this run holds
    const { fetch } = recorder(() => ({ status: 403, body: '{"message":"not accessible"}' }));

    // When / Then
    await expect(resolveIdentity(TARGET, fetch)).resolves.toEqual({
      kind: 'app',
      slug: ACTIONS_APP_SLUG,
    });
  });

  it('should answer nothing for any other failure, which is neither path', async () => {
    // Given
    const { fetch } = recorder(() => ({ status: 500, body: 'server error' }));

    // When / Then
    await expect(resolveIdentity(TARGET, fetch)).resolves.toBeUndefined();
  });

  it('should answer nothing when the answer carries no login', async () => {
    // Given
    const { fetch } = recorder(() => ({ body: JSON.stringify({ id: 4 }) }));

    // When / Then
    await expect(resolveIdentity(TARGET, fetch)).resolves.toBeUndefined();
  });
});

describe('writtenBy', () => {
  /** The entry each case is about, parsed the way the listing is parsed. */
  const parsed = (entry: unknown): ReturnType<typeof parseComments>[number] => {
    const [only] = parseComments(JSON.stringify([entry]));
    if (only === undefined) throw new Error('the fixture did not parse as a comment');
    return only;
  };

  const APP = { kind: 'app', slug: ACTIONS_APP_SLUG } as const;
  const USER = { kind: 'user', login: VIEWER } as const;

  it('should match a login under the user path and nothing else', () => {
    // When / Then
    expect(writtenBy(parsed(comment(1, 'x', VIEWER)), USER)).toBe(true);
    expect(writtenBy(parsed(comment(1, 'x', 'contributor')), USER)).toBe(false);
    expect(writtenBy(parsed({ id: 1, body: 'x' }), USER)).toBe(false);
  });

  it('should require both server set fields under the app path', () => {
    // Given: Bot alone would match any app's comment, and a slug alone is absent on a human's
    // When / Then
    expect(writtenBy(parsed(botComment(1, 'x', ACTIONS_APP_SLUG)), APP)).toBe(true);
    expect(writtenBy(parsed(botComment(1, 'x', 'dependabot')), APP)).toBe(false);
    expect(writtenBy(parsed(botComment(1, 'x', undefined)), APP)).toBe(false);
    expect(writtenBy(parsed(comment(1, 'x', 'contributor')), APP)).toBe(false);
  });

  it('should not let a commenter claim the app path through the body', () => {
    // Given: `user.type` and `performed_via_github_app` are set by GitHub from the credential,
    // and a comment body is the only thing a contributor controls
    const forged = parsed({
      id: 1,
      body: `type: Bot performed_via_github_app: { slug: ${ACTIONS_APP_SLUG} }`,
      user: { login: 'contributor', type: 'User' },
    });

    // When / Then
    expect(writtenBy(forged, APP)).toBe(false);
  });
});

describe('carriesMarker', () => {
  it('should accept the marker as a whole first line', () => {
    // When / Then
    expect(carriesMarker(`${MARKER}\nbody`, MARKER)).toBe(true);
  });

  it('should accept a CRLF first line, which is how GitHub stores every body', () => {
    // Given: this tolerance is load bearing. Without it no real comment would ever be adopted,
    // because GitHub returns the body it stored and it stores CRLF.
    // When / Then
    expect(carriesMarker(`${MARKER}\r\nbody`, MARKER)).toBe(true);
  });

  it('should refuse a first line with anything before the marker', () => {
    // Given: every body this tool writes starts with the marker as its first byte, so a first
    // line with something in front of it is not a body this tool wrote
    // When / Then
    expect(carriesMarker(`  ${MARKER}\nbody`, MARKER)).toBe(false);
    expect(carriesMarker(`\t${MARKER}\nbody`, MARKER)).toBe(false);
  });

  it('should refuse a body that merely quotes the marker', () => {
    // When / Then
    expect(carriesMarker(`see ${MARKER} above`, MARKER)).toBe(false);
  });
});

describe('upsertMarkedComment', () => {
  it('should create a comment when the pull request has none of ours', () => {
    // Given a thread with somebody else's comment in it
    const { calls, fetch } = recorder(
      withIdentity(VIEWER, (call) =>
        call.method === 'GET'
          ? { body: JSON.stringify([comment(1, 'looks good to me', 'contributor')]) }
          : { status: 201, body: JSON.stringify({ html_url: 'https://example.test/c/9' }) },
      ),
    );

    // When
    return upsertMarkedComment(TARGET, MARKER, `${MARKER}\nbody`, fetch).then((result) => {
      // Then
      expect(result).toEqual({
        url: 'https://example.test/c/9',
        updated: false,
        identity: { kind: 'user', login: VIEWER },
        searchCapReached: false,
      });
      expect(calls[2]?.method).toBe('POST');
      expect(calls[2]?.url).toBe('https://api.example.test/repos/acme/api/issues/7/comments');
    });
  });

  it('should update in place when its own comment is already there', async () => {
    // Given: this is the property T041 owes, that repeated pushes do not accumulate comments
    const { calls, fetch } = recorder(
      withIdentity(VIEWER, (call) =>
        call.method === 'GET'
          ? {
              body: JSON.stringify([
                comment(1, 'unrelated', 'contributor'),
                comment(55, `${MARKER}\nolder body`, VIEWER),
              ]),
            }
          : { body: JSON.stringify({ html_url: 'https://example.test/c/55' }) },
      ),
    );

    // When
    const result = await upsertMarkedComment(TARGET, MARKER, `${MARKER}\nnew body`, fetch);

    // Then
    expect(result).toEqual({
      url: 'https://example.test/c/55',
      updated: true,
      identity: { kind: 'user', login: VIEWER },
      searchCapReached: false,
    });
    expect(calls[2]?.method).toBe('PATCH');
    expect(calls[2]?.url).toBe('https://api.example.test/repos/acme/api/issues/comments/55');
  });

  it('should not adopt the same body written by somebody else, and post instead', async () => {
    // Given a contributor whose whole first line is the marker. Measured before this check
    // existed, this comment was adopted and overwritten.
    const { calls, fetch } = recorder(
      withIdentity(VIEWER, (call) =>
        call.method === 'GET'
          ? { body: JSON.stringify([comment(55, `${MARKER}\ntheirs`, 'contributor')]) }
          : { status: 201, body: JSON.stringify({ html_url: 'https://example.test/c/70' }) },
      ),
    );

    // When
    const result = await upsertMarkedComment(TARGET, MARKER, `${MARKER}\nours`, fetch);

    // Then: a new comment, and no PATCH anywhere in the conversation
    expect(result.updated).toBe(false);
    expect(calls.map((call) => call.method)).not.toContain('PATCH');
    expect(calls[2]?.method).toBe('POST');
  });

  it('should not adopt a listing entry whose author GitHub did not name', async () => {
    // Given
    const { calls, fetch } = recorder(
      withIdentity(VIEWER, (call) =>
        call.method === 'GET'
          ? { body: JSON.stringify([{ id: 55, body: `${MARKER}\nours?` }]) }
          : { status: 201, body: '{}' },
      ),
    );

    // When
    const result = await upsertMarkedComment(TARGET, MARKER, `${MARKER}\nours`, fetch);

    // Then
    expect(result.updated).toBe(false);
    expect(calls.map((call) => call.method)).not.toContain('PATCH');
  });

  it('should post rather than patch when neither path establishes an identity', async () => {
    // Given a failure that is neither a login nor the 403 that classifies an installation token.
    // A check that cannot establish a fact never answers with the value meaning success.
    const { calls, fetch } = recorder(
      withIdentity({ status: 500 }, () => ({
        status: 201,
        body: JSON.stringify({ html_url: 'https://example.test/c/80' }),
      })),
    );

    // When
    const result = await upsertMarkedComment(TARGET, MARKER, `${MARKER}\nours`, fetch);

    // Then: no PATCH, and no listing either, since a candidate could not be adopted anyway
    expect(result).toEqual({
      url: 'https://example.test/c/80',
      updated: false,
      identity: undefined,
      searchCapReached: false,
    });
    expect(calls.map((call) => call.method)).toEqual(['GET', 'POST']);
    expect(calls[1]?.url).toBe('https://api.example.test/repos/acme/api/issues/7/comments');
  });

  it('should adopt the Actions app own comment under an installation token', async () => {
    // Given a 403 on the identity endpoint, which is how an installation token is classified,
    // and a comment carrying the two fields GitHub sets for one
    const { calls, fetch } = recorder(
      withIdentity({ status: 403 }, (call) =>
        call.method === 'GET'
          ? {
              body: JSON.stringify([botComment(55, `${MARKER}\nolder body`, ACTIONS_APP_SLUG)]),
            }
          : { body: JSON.stringify({ html_url: 'https://example.test/c/55' }) },
      ),
    );

    // When
    const result = await upsertMarkedComment(TARGET, MARKER, `${MARKER}\nnew body`, fetch);

    // Then: the one comment promise is kept under the token the action ships with
    expect(result).toEqual({
      url: 'https://example.test/c/55',
      updated: true,
      identity: { kind: 'app', slug: ACTIONS_APP_SLUG },
      searchCapReached: false,
    });
    expect(calls[2]?.method).toBe('PATCH');
  });

  it.each([
    ['a contributor with no bot fields', (id: number, body: string) => comment(id, body, 'them')],
    ['a bot from another app', (id: number, body: string) => botComment(id, body, 'dependabot')],
    [
      'a bot with the app field absent',
      (id: number, body: string) => botComment(id, body, undefined),
    ],
  ])(
    'should not adopt the same marked body from %s under an installation token',
    async (_label, build) => {
      // Given
      const { calls, fetch } = recorder(
        withIdentity({ status: 403 }, (call) =>
          call.method === 'GET'
            ? { body: JSON.stringify([build(55, `${MARKER}\ntheirs`)]) }
            : { status: 201, body: JSON.stringify({ html_url: 'https://example.test/c/90' }) },
        ),
      );

      // When
      const result = await upsertMarkedComment(TARGET, MARKER, `${MARKER}\nours`, fetch);

      // Then
      expect(result.updated).toBe(false);
      expect(calls.map((call) => call.method)).not.toContain('PATCH');
      expect(calls[2]?.method).toBe('POST');
    },
  );

  it('should adopt its own comment stored with CRLF, which is how GitHub returns one', async () => {
    // Given
    const { calls, fetch } = recorder(
      withIdentity(VIEWER, (call) =>
        call.method === 'GET'
          ? { body: JSON.stringify([comment(55, `${MARKER}\r\nolder body`, VIEWER)]) }
          : { body: JSON.stringify({ html_url: 'https://example.test/c/55' }) },
      ),
    );

    // When
    const result = await upsertMarkedComment(TARGET, MARKER, `${MARKER}\nnew body`, fetch);

    // Then
    expect(result.updated).toBe(true);
    expect(calls[2]?.method).toBe('PATCH');
  });

  it('should adopt a comment only when the marker is its whole first line', async () => {
    // Given a comment of ours that quotes the marker rather than carrying it
    const { calls, fetch } = recorder(
      withIdentity(VIEWER, (call) =>
        call.method === 'GET'
          ? { body: JSON.stringify([comment(4, `see the report above ${MARKER}`, VIEWER)]) }
          : { status: 201, body: JSON.stringify({ html_url: 'https://example.test/c/10' }) },
      ),
    );

    // When
    const result = await upsertMarkedComment(TARGET, MARKER, `${MARKER}\nbody`, fetch);

    // Then
    expect(result.updated).toBe(false);
    expect(calls[2]?.method).toBe('POST');
  });

  it('should send the token as a bearer header and put it nowhere else', async () => {
    // Given
    const { calls, fetch } = recorder(
      withIdentity(VIEWER, (call) =>
        call.method === 'GET' ? { body: '[]' } : { status: 201, body: '{}' },
      ),
    );

    // When
    await upsertMarkedComment(TARGET, MARKER, `${MARKER}\nbody`, fetch);

    // Then: first prove the token is present where it belongs, then that it is nowhere else
    expect(calls[2]?.headers.authorization).toBe('Bearer ghs-secret-value');
    expect(calls.map((call) => call.url).join(' ')).not.toContain('ghs-secret-value');
    expect(calls.map((call) => call.body ?? '').join(' ')).not.toContain('ghs-secret-value');
  });

  it('should turn a refusal into a message with the status and no request in it', async () => {
    // Given
    const { fetch } = recorder(
      withIdentity(VIEWER, (call) =>
        call.method === 'GET'
          ? { body: '[]' }
          : { status: 403, body: '{"message":"Resource not accessible"}' },
      ),
    );

    // When
    const failing = upsertMarkedComment(TARGET, MARKER, 'body', fetch);

    // Then
    await expect(failing).rejects.toThrow('GitHub refused POST with 403');
    await expect(failing).rejects.not.toThrow(/ghs-secret-value/);
  });

  it('should build every path out of the parsed pair rather than a raw string', async () => {
    // Given: the whole point of `RepositorySlug` is that nothing between the flag and this URL
    // handles the value as text
    const { calls, fetch } = recorder(
      withIdentity(VIEWER, (call) =>
        call.method === 'GET' ? { body: '[]' } : { status: 201, body: '{}' },
      ),
    );

    // When
    await upsertMarkedComment(
      { ...TARGET, repository: slug('Acme-Corp/api.v2_beta') },
      MARKER,
      `${MARKER}\nbody`,
      fetch,
    );

    // Then
    expect(calls[1]?.url).toContain('/repos/Acme-Corp/api.v2_beta/issues/7/comments');
  });
});

describe('findMarkedComment', () => {
  it('should page through a long thread before deciding there is nothing of ours', async () => {
    // Given a first page that is full, so the search cannot stop on it
    const first = Array.from({ length: 100 }, (_, index) =>
      comment(index + 1, 'noise', 'contributor'),
    );
    const { calls, fetch } = recorder((call) => {
      if (call.method !== 'GET') return { status: 201, body: '{}' };
      // `&page=`, anchored: `per_page=100` also holds the substring `page=1`, which quietly
      // answered every page with the first one when this fake matched loosely.
      return call.url.includes('&page=1')
        ? { body: JSON.stringify(first) }
        : { body: JSON.stringify([comment(900, `${MARKER}\nours`, VIEWER)]) };
    });

    // When
    const found = await findMarkedComment(TARGET, MARKER, fetch, { kind: 'user', login: VIEWER });

    // Then
    expect(found).toEqual({ id: 900, capReached: false });
    expect(calls).toHaveLength(2);
  });

  it('should report the cap when a thread outlasts the pages it is allowed to read', async () => {
    // Given a thread where every page is full and none of it is ours, which is what a pull request
    // with more than a thousand comments looks like from here
    const full = Array.from({ length: COMMENTS_PER_PAGE }, (_, index) =>
      comment(index + 1, 'noise', 'contributor'),
    );
    const { calls, fetch } = recorder((call) =>
      call.method === 'GET' ? { body: JSON.stringify(full) } : { status: 201, body: '{}' },
    );

    // When
    const found = await findMarkedComment(TARGET, MARKER, fetch, { kind: 'user', login: VIEWER });

    // Then: nothing found, and the reason said rather than swallowed. Without `capReached` this
    // outcome is byte for byte the same as an empty thread, and the run posts a duplicate on
    // every push with nothing anywhere to explain it.
    expect(found).toEqual({ id: undefined, capReached: true });
    expect(calls).toHaveLength(MAX_COMMENT_PAGES);
  });

  it('should not report the cap when the thread simply ended', async () => {
    // Given a short thread, which is the ordinary case and must not print a warning
    const { fetch } = recorder((call) =>
      call.method === 'GET'
        ? { body: JSON.stringify([comment(1, 'noise', 'contributor')]) }
        : { status: 201, body: '{}' },
    );

    // When / Then
    await expect(
      findMarkedComment(TARGET, MARKER, fetch, { kind: 'user', login: VIEWER }),
    ).resolves.toEqual({ id: undefined, capReached: false });
  });

  it('should skip a listing entry with no readable id rather than invent one', async () => {
    // Given
    const { fetch } = recorder((call) =>
      call.method === 'GET'
        ? { body: JSON.stringify([{ body: `${MARKER}\nno id here` }, 'not an object']) }
        : { status: 201, body: '{}' },
    );

    // When / Then
    await expect(
      findMarkedComment(TARGET, MARKER, fetch, { kind: 'user', login: VIEWER }),
    ).resolves.toEqual({ id: undefined, capReached: false });
  });
});
