/**
 * The fake authorization server, and the reason it exists rather than a mock.
 *
 * THE SIGN IN RETURN IS THE ONE SHIPPED GESTURE THAT HAD NEVER RUN IN A BROWSER. Three of the four
 * chunks the bundle divides into are driven by a real engine in `first-minute.spec.ts` and
 * `navigation-fetch.spec.ts`; `sign-in-return` was driven only in jsdom and under Node, which is
 * precisely the environment where a bare specifier resolves and where no policy is enforced. It is
 * also the gesture that handles a credential. The amendment filed against T035 says what closing
 * that costs, and this file is the cost: an authorize endpoint that redirects back to the mount's
 * own callback, and a token endpoint that answers over CORS, because the exchange is a browser
 * `fetch` and only a server the test controls will allow this origin.
 *
 * ONE BOOT SERVES EVERY CASE. The mode travels on the authorize url as a query parameter, is
 * remembered with the code, and decides what the token endpoint answers. That keeps the browser
 * suite to one spawn instead of one per crafted response, and it keeps the modes honest: every one
 * of them runs the same authorize leg that the ordinary case runs.
 *
 * WHAT IT DELIBERATELY DOES NOT DO, so that no case reads as a proof of something larger: it issues
 * no refresh token, so the renewal path of SPEC 14.4.1 is still only covered under Node; it runs no
 * device flow; and it does not implement `client_secret_post`, because the runner sends a secret in
 * the Basic header and a second spelling here would be a server feature nothing exercises.
 */

import { createHash, randomBytes } from 'node:crypto';
import express from 'express';
import type { Request, Response } from 'express';

/**
 * What one sign in is made to do.
 *
 * Every mode below `ordinary` is one of T035's crafted responses. They are named for what the
 * server does rather than for what the client should conclude, because naming them for the
 * conclusion is how a fixture comes to assert its own expectation.
 */
export type AuthorizationMode =
  /** A correct authorization code exchange with PKCE S256 and a single use code. */
  | 'ordinary'
  /** The callback carries a `state` this server invented instead of the one it was sent. */
  | 'foreign-state'
  /** The token endpoint answers with an access token of {@link OVERSIZED_TOKEN_BYTES}. */
  | 'oversized-token'
  /** The token endpoint answers with an access token carrying CR, LF and NUL. */
  | 'control-token'
  /** The token endpoint answers 302 to the other origin this server also listens on. */
  | 'redirecting-token';

/** Every mode, so a caller can drive the whole set without repeating the union. */
export const AUTHORIZATION_MODES: readonly AuthorizationMode[] = [
  'ordinary',
  'foreign-state',
  'oversized-token',
  'control-token',
  'redirecting-token',
];

/**
 * Size of the token the oversized mode answers with.
 *
 * 100 KB, the figure T035 uses for a hostile but schema valid value elsewhere. It is above every
 * real token and below the point where the case would be measuring a Node buffer limit rather than
 * what the console does with a large credential.
 */
export const OVERSIZED_TOKEN_BYTES = 100 * 1024;

/** Client id the fixture document declares, so a case does not have to type one. */
export const AUTHORIZATION_CLIENT_ID = 'openref-browser-proof';

/** Path of the authorize endpoint. */
export const AUTHORIZE_PATH = '/authorize';

/** Path of the token endpoint. */
export const TOKEN_PATH = '/token';

/** Path the redirecting mode sends the token request to, on the other origin. */
export const ELSEWHERE_TOKEN_PATH = '/token-elsewhere';

/** Id of the security scheme one mode is driven through. */
export function schemeIdFor(mode: AuthorizationMode): string {
  return `oauth-${mode}`;
}

/** Path of the operation whose console drives one mode. */
export function operationPathFor(mode: AuthorizationMode): string {
  return `/v1/sign-in-${mode}`;
}

/**
 * The document surface one authorization server adds: a scheme and an operation per mode.
 *
 * ONE OPERATION PER MODE, because the console draws the schemes the operation in front of it
 * requires. Putting five schemes on one operation would draw five Sign in buttons in one panel and
 * make every case depend on picking the right one out of a list, which is a test of the selector
 * rather than of the gesture.
 *
 * @param origin - Where the fake authorization server listens
 * @returns The `securitySchemes` and `paths` fragments to merge into the fixture document
 */
export function authorizationDocumentSurface(origin: string): {
  readonly securitySchemes: Record<string, unknown>;
  readonly paths: Record<string, unknown>;
  readonly servers: readonly Record<string, unknown>[];
} {
  const securitySchemes: Record<string, unknown> = {};
  const paths: Record<string, unknown> = {};

  for (const mode of AUTHORIZATION_MODES) {
    const id = schemeIdFor(mode);

    securitySchemes[id] = {
      type: 'oauth2',
      flows: {
        authorizationCode: {
          // THE MODE TRAVELS ON THE AUTHORIZE URL, which is also why `authorizationUrl` appending
          // its own query with `&` rather than `?` is exercised by every one of these.
          authorizationUrl: `${origin}${AUTHORIZE_PATH}?mode=${mode}`,
          tokenUrl: `${origin}${TOKEN_PATH}`,
          scopes: { 'orders:read': 'Read orders' },
        },
      },
    };

    paths[operationPathFor(mode)] = {
      get: {
        operationId: `signIn${mode.replaceAll('-', '_')}`,
        summary: `Sign in, ${mode}`,
        description: `Drives the ${mode} case of the fake authorization server.`,
        tags: ['sign-in'],
        security: [{ [id]: ['orders:read'] }],
        responses: { '200': { description: 'Signed in' } },
      },
    };
  }

  // A SERVER, BECAUSE WITHOUT ONE THERE IS NO CONSOLE. The budget fixture declares none, which is
  // correct for what it measures and fatal here: a document with nowhere to send has no try-it
  // region at all, so the Sign in button never renders. It is relative, because the fixture's own
  // port is chosen by the operating system and nothing in these cases ever presses Send.
  return { securitySchemes, paths, servers: [{ url: '/api', description: 'The fake API' }] };
}

/** What was remembered when a code was issued. */
interface IssuedCode {
  readonly mode: AuthorizationMode;
  readonly challenge: string;
  readonly redirectUri: string;
  /** A code is single use, and a second exchange is what the replay case reads. */
  spent: boolean;
}

/**
 * Route the harness names the reference's origin on, once both are listening.
 *
 * A CONCRETE ORIGIN RATHER THAN `*`, because the exchange carries an Authorization header and a
 * wildcard would let the case pass under a rule no real provider offers. It arrives after boot
 * because both ports are chosen by the operating system and each server needs the other's: the
 * reference has to carry this server's urls in its document, and this server has to allow the
 * reference's origin. Until it is called, the token endpoint sends no CORS headers at all, so a
 * harness that forgot the step fails loudly rather than passing under a wildcard.
 */
export const ALLOW_CONTROL_PATH = '/_control/allow';

/** How one server is built. */
export interface AuthorizationServerOptions {
  /** Where the redirecting mode points, which is this server's other origin. */
  readonly elsewhereOrigin?: string;
}

function modeOf(value: unknown): AuthorizationMode {
  const named = AUTHORIZATION_MODES.find((mode) => mode === value);

  return named ?? 'ordinary';
}

function challengeOf(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/** The token body one mode answers with, before it is turned into a response. */
function tokenBody(mode: AuthorizationMode): Record<string, unknown> {
  if (mode === 'oversized-token') {
    return { access_token: 'A'.repeat(OVERSIZED_TOKEN_BYTES), token_type: 'Bearer' };
  }

  if (mode === 'control-token') {
    // A HEADER INJECTION IF ANYTHING EVER CONCATENATES IT. The runner writes
    // `Authorization: Bearer ${value}`, so what this case asks is what stops a token that closes
    // the header and opens another one.
    return { access_token: 'good\r\nX-Injected: yes\r\n\u0000tail', token_type: 'Bearer' };
  }

  return {
    access_token: `fake-access-token-${randomBytes(8).toString('hex')}`,
    token_type: 'Bearer',
  };
}

/**
 * Builds the authorization server.
 *
 * @param options - The origin allowed to exchange, and the other origin for the redirect mode
 * @returns The application, not yet listening
 */
export function createAuthorizationServer(
  options: AuthorizationServerOptions = {},
): express.Express {
  const app = express();
  const codes = new Map<string, IssuedCode>();
  let allowedOrigin: string | null = null;

  app.use(express.urlencoded({ extended: false }));

  app.get(ALLOW_CONTROL_PATH, (request: Request, response: Response) => {
    const origin = (request.query as Record<string, string | undefined>).origin ?? '';
    if (origin === '') {
      response.status(400).type('text/plain').send('no origin');
      return;
    }

    allowedOrigin = origin;
    response.status(204).end();
  });

  // CORS ON THE TOKEN ENDPOINT ONLY. The authorize leg is a navigation and needs none, and a
  // server that allowed the origin everywhere would let a case pass that a real provider refuses.
  const allowExchange = (response: Response): void => {
    if (allowedOrigin === null) return;

    response.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    response.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Vary', 'Origin');
  };

  app.options([TOKEN_PATH, ELSEWHERE_TOKEN_PATH], (_request: Request, response: Response) => {
    allowExchange(response);
    response.status(204).end();
  });

  /**
   * The authorize leg, which every mode runs identically except for the state it answers with.
   */
  app.get(AUTHORIZE_PATH, (request: Request, response: Response) => {
    const query = request.query as Record<string, string | undefined>;
    const mode = modeOf(query.mode);
    const redirectUri = query.redirect_uri ?? '';
    const state = query.state ?? '';
    const challenge = query.code_challenge ?? '';
    const method = query.code_challenge_method ?? '';

    if (redirectUri === '') {
      response.status(400).type('text/plain').send('no redirect_uri');
      return;
    }

    // PKCE IS REQUIRED BY THIS SERVER TOO, so a client that stopped sending a challenge would fail
    // here rather than sail through a fixture that never asked.
    if (challenge === '' || method !== 'S256') {
      response.status(400).type('text/plain').send('this server requires PKCE S256');
      return;
    }

    const code = randomBytes(16).toString('hex');
    codes.set(code, { mode, challenge, redirectUri, spent: false });

    const answered = new URL(redirectUri);
    answered.searchParams.set('code', code);
    answered.searchParams.set(
      'state',
      mode === 'foreign-state' ? `${randomBytes(8).toString('hex')}.Lw` : state,
    );

    response.redirect(302, answered.toString());
  });

  const exchange = (request: Request, response: Response): void => {
    allowExchange(response);

    const body = request.body as Record<string, string | undefined>;
    const code = body.code ?? '';
    const verifier = body.code_verifier ?? '';
    const issued = codes.get(code);

    if (issued === undefined) {
      response.status(400).json({ error: 'invalid_grant', error_description: 'no such code' });
      return;
    }

    // SINGLE USE, WHICH IS WHAT THE REPLAYED CALLBACK CASE READS. A second exchange of one code is
    // the answer a real provider gives, and it is the only way to tell a replay that reached the
    // server from one the page refused before sending anything.
    if (issued.spent) {
      response
        .status(400)
        .json({ error: 'invalid_grant', error_description: 'this code has already been used' });
      return;
    }

    if (challengeOf(verifier) !== issued.challenge) {
      response
        .status(400)
        .json({ error: 'invalid_grant', error_description: 'the code verifier does not match' });
      return;
    }

    issued.spent = true;

    if (issued.mode === 'redirecting-token' && options.elsewhereOrigin !== undefined) {
      // 307 RATHER THAN 302, because 302 turns the POST into a GET and drops the body, and the
      // question this case asks is whether a client secret and a code verifier can be moved to a
      // host the document never named. 307 is the shape that would move them.
      response.redirect(307, `${options.elsewhereOrigin}${ELSEWHERE_TOKEN_PATH}`);
      return;
    }

    response.status(200).json(tokenBody(issued.mode));
  };

  app.post(TOKEN_PATH, exchange);

  // THE OTHER ORIGIN ANSWERS A PERFECTLY GOOD TOKEN, which is the point: if the runner followed the
  // redirect it would succeed, and a case that only ever saw a failure here would not know whether
  // the refusal or the second host was what stopped it.
  app.post(ELSEWHERE_TOKEN_PATH, (_request: Request, response: Response) => {
    allowExchange(response);
    response
      .status(200)
      .json({ access_token: 'token-from-an-unexpected-host', token_type: 'Bearer' });
  });

  return app;
}
