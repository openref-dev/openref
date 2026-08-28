import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A GitHub issue comments API, small enough to hold in the head and real enough to be spoken to
 * over a socket.
 *
 * IT IS A SERVER AND NOT A STUBBED `fetch` ON PURPOSE. What is under test on this path is the
 * adapter's whole conversation, the identity lookup, the listing, the choice between POST and
 * PATCH, and the headers that go out; a stub would prove the calls this test expected rather than
 * the calls that happen. It is also what makes "zero requests were sent" a measurement: the fake
 * records every request that reaches the socket, including the ones nobody meant to send.
 *
 * IT ATTRIBUTES COMMENTS THE WAY GITHUB DOES. A comment created through it belongs to the login
 * `GET /user` answers with, and a comment seeded into it can belong to anybody, which is what
 * makes the author check testable at all.
 */

/** The login the fake authenticates every token as, unless it is told to refuse. */
export const FAKE_VIEWER = 'openref-bot';

/** The login GitHub gives a comment written with an Actions installation token. */
export const FAKE_ACTIONS_LOGIN = 'github-actions[bot]';

/** The slug that installation's app answers to. */
export const FAKE_ACTIONS_APP = 'github-actions';

/** One request the fake saw. */
export interface RecordedRequest {
  readonly method: string;
  readonly url: string;
  readonly authorization: string | undefined;
  readonly body: string;
}

/** One comment on the thread, with the two fields GitHub sets from the credential. */
export interface FakeComment {
  id: number;
  body: string;
  author: string;
  /** `user.type`: `User` for a person, `Bot` for an app's installation. */
  authorType: string;
  /** `performed_via_github_app.slug`, absent for a person. */
  appSlug?: string | undefined;
}

/** The fake, its address, and what it saw. */
export interface FakeGitHub {
  readonly url: string;
  readonly requests: RecordedRequest[];
  /** Comments currently on the thread, in the order they were created. */
  readonly comments: FakeComment[];
  /** Puts a comment on the thread as somebody else, the way a contributor or another app would. */
  readonly seed: (comment: {
    readonly body: string;
    readonly author: string;
    readonly authorType?: string;
    readonly appSlug?: string;
  }) => number;
  readonly close: () => Promise<void>;
}

/** How the fake answers the identity request. */
export interface FakeGitHubOptions {
  /**
   * `ok` answers with {@link FAKE_VIEWER}; `refused` answers 403 the way GitHub does for a
   * GitHub App installation token; `unreadable` answers 200 with a body that names no login.
   */
  readonly identity?: 'ok' | 'refused' | 'unreadable';
  /**
   * When set, every request is answered with a 302 to this address instead of being served.
   *
   * A REAL REDIRECTOR RATHER THAN A STUBBED RESPONSE, because what is under test is what the HTTP
   * client does with a 302 while carrying a credential, and that is a property of the client and
   * the socket rather than of anything this repository can assert about itself. The fake still
   * records the request that got the redirect, so "no second request was made" is a measurement.
   */
  readonly redirectTo?: string;
}

/**
 * Starts the fake on a loopback port.
 *
 * @param options - How it answers the identity request
 * @returns The running fake
 */
export async function startFakeGitHub(options: FakeGitHubOptions = {}): Promise<FakeGitHub> {
  const identity = options.identity ?? 'ok';
  const requests: RecordedRequest[] = [];
  const comments: FakeComment[] = [];
  let nextId = 100;

  const server: Server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const url = request.url ?? '';
      const method = request.method ?? 'GET';
      const authorization = request.headers.authorization;
      requests.push({ method, url, authorization, body });

      const reply = (status: number, payload: unknown): void => {
        response.writeHead(status, { 'content-type': 'application/json' });
        response.end(JSON.stringify(payload));
      };

      if (options.redirectTo !== undefined) {
        response.writeHead(302, { location: options.redirectTo, 'content-type': 'text/plain' });
        response.end('moved');
        return;
      }

      if (method === 'GET' && url === '/user') {
        if (identity === 'refused') {
          reply(403, { message: 'Resource not accessible by integration' });
          return;
        }
        reply(200, identity === 'unreadable' ? { id: 1 } : { login: FAKE_VIEWER });
        return;
      }

      if (method === 'GET' && url.includes('/comments')) {
        // PAGINATED THE WAY GITHUB PAGINATES, because the page cap is a real limit and a fake that
        // answered everything on page one could never reach it. A short page is how the caller
        // learns the thread has ended, so the slice has to be a real slice.
        const query = new URL(url, 'http://localhost').searchParams;
        const page = Math.max(1, Number(query.get('page') ?? '1'));
        const perPage = Math.max(1, Number(query.get('per_page') ?? '30'));
        const from = (page - 1) * perPage;
        reply(200, comments.slice(from, from + perPage).map(asListingEntry));
        return;
      }

      if (method === 'POST' && url.includes('/comments')) {
        // ATTRIBUTED THE WAY THE TOKEN WOULD BE. Under a refused identity the fake is standing in
        // for an installation token, so what it writes carries the two fields GitHub sets for one.
        const created: FakeComment =
          identity === 'refused'
            ? {
                id: nextId++,
                body: readBody(body),
                author: FAKE_ACTIONS_LOGIN,
                authorType: 'Bot',
                appSlug: FAKE_ACTIONS_APP,
              }
            : { id: nextId++, body: readBody(body), author: FAKE_VIEWER, authorType: 'User' };
        comments.push(created);
        reply(201, {
          ...asListingEntry(created),
          html_url: `https://github.test/c/${String(created.id)}`,
        });
        return;
      }

      const patched = /\/issues\/comments\/(\d+)$/.exec(url);
      if (method === 'PATCH' && patched !== null) {
        const id = Number(patched[1]);
        const found = comments.find((comment) => comment.id === id);
        if (found === undefined) {
          reply(404, { message: 'Not Found' });
          return;
        }
        found.body = readBody(body);
        reply(200, {
          ...asListingEntry(found),
          html_url: `https://github.test/c/${String(found.id)}`,
        });
        return;
      }

      reply(404, { message: `the fake does not serve ${method} ${url}` });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${String(address.port)}`,
    requests,
    comments,
    seed: (comment) => {
      const id = nextId++;
      comments.push({
        id,
        body: comment.body,
        author: comment.author,
        authorType: comment.authorType ?? 'User',
        appSlug: comment.appSlug,
      });
      return id;
    },
    close: () =>
      new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        }),
      ),
  };
}

/** One comment in the shape GitHub returns it, app field omitted when there is no app. */
function asListingEntry(comment: FakeComment): Record<string, unknown> {
  return {
    id: comment.id,
    body: comment.body,
    user: { login: comment.author, type: comment.authorType },
    ...(comment.appSlug === undefined
      ? {}
      : { performed_via_github_app: { slug: comment.appSlug } }),
  };
}

function readBody(raw: string): string {
  try {
    const parsed: unknown = JSON.parse(raw);
    const body = (parsed as { body?: unknown }).body;
    return typeof body === 'string' ? body : '';
  } catch {
    return '';
  }
}
