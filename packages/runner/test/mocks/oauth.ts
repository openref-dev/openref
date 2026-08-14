import type {
  IHttpTransport,
  RequestPlan,
  RunnableOAuthFlow,
  TransportResponse,
} from '../../src/index';

/**
 * What the OAuth2 tests send against, per SPEC 14.4 and 14.4.1.
 *
 * A SCRIPTED TRANSPORT RATHER THAN A SERVER, because what these tests are about is what was sent
 * and how an answer was classified, and both are values. The one thing a fake must not hide is how
 * many requests were made, so every plan is recorded in order and the counts are what the one
 * refresh and one retry rule is asserted on.
 */

/** A transport that answers from a script and remembers every request it was given. */
export class ScriptedTransport implements IHttpTransport {
  readonly sent: RequestPlan[] = [];

  private readonly answers: (TransportResponse | Error)[];
  private readonly fallback: TransportResponse;

  /**
   * @param answers - Answers in order, an `Error` for a request that never reached a server
   * @param fallback - What to answer once the script has run out
   */
  constructor(
    answers: (TransportResponse | Error)[],
    fallback: TransportResponse = reply(200, '{}'),
  ) {
    this.answers = answers;
    this.fallback = fallback;
  }

  /** How many requests went to this url. */
  countTo(url: string): number {
    return this.sent.filter((plan) => plan.url === url).length;
  }

  /** The bodies sent to one url, parsed as the form the token endpoint takes. */
  formsTo(url: string): URLSearchParams[] {
    return this.sent
      .filter((plan) => plan.url === url)
      .map((plan) => new URLSearchParams(typeof plan.body === 'string' ? plan.body : ''));
  }

  /**
   * @param plan - The request as `buildRequest` resolved it
   * @returns The next scripted answer
   */
  async send(plan: RequestPlan): Promise<TransportResponse> {
    this.sent.push(plan);

    const next = this.answers.shift() ?? this.fallback;
    if (next instanceof Error) throw next;

    return Promise.resolve(next);
  }
}

/** One answer, as a transport reports it. */
export function reply(status: number, body: string): TransportResponse {
  return { status, statusText: '', headers: [], body };
}

/** A token endpoint answer with the fields RFC 6749 names. */
export function tokenReply(
  overrides: Partial<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
  }> = {},
): TransportResponse {
  return reply(
    200,
    JSON.stringify({ access_token: 'access-1', token_type: 'Bearer', ...overrides }),
  );
}

/** The token endpoint every flow in these tests posts to. */
export const TOKEN_URL = 'https://auth.example.com/token';

/** Where the reader is sent for the two flows that redirect. */
export const AUTHORIZE_URL = 'https://auth.example.com/authorize';

/** Where a device flow starts. */
export const DEVICE_URL = 'https://auth.example.com/device';

/** The authorization code flow, which PKCE S256 is mandatory on. */
export const CODE_FLOW: RunnableOAuthFlow = {
  kind: 'authorizationCode',
  authorizationUrl: AUTHORIZE_URL,
  tokenUrl: TOKEN_URL,
  scopes: ['orders:read'],
};

/** The client credentials flow, which holds what a token is made from. */
export const CLIENT_FLOW: RunnableOAuthFlow = {
  kind: 'clientCredentials',
  tokenUrl: TOKEN_URL,
  scopes: [],
};

/** The resource owner password flow. */
export const PASSWORD_FLOW: RunnableOAuthFlow = {
  kind: 'password',
  tokenUrl: TOKEN_URL,
  scopes: [],
};

/** The implicit flow, which hands back no refresh token. */
export const IMPLICIT_FLOW: RunnableOAuthFlow = {
  kind: 'implicit',
  authorizationUrl: AUTHORIZE_URL,
  scopes: [],
};

/** The device flow of RFC 8628. */
export const DEVICE_FLOW: RunnableOAuthFlow = {
  kind: 'deviceAuthorization',
  deviceAuthorizationUrl: DEVICE_URL,
  tokenUrl: TOKEN_URL,
  scopes: [],
};

/** Random bytes a test can predict, so a verifier and a state are comparable. */
export function fixedRandom(seed = 7): (length: number) => Uint8Array {
  let counter = seed;

  return (length: number): Uint8Array => {
    const bytes = new Uint8Array(length);
    for (let index = 0; index < length; index += 1) {
      counter = (counter * 31 + 17) % 251;
      bytes[index] = counter;
    }

    return bytes;
  };
}

/** A plain object standing in for a `Storage`, which is all the runner asks for. */
export function fakeStorage(): {
  readonly entries: Map<string, string>;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
} {
  const entries = new Map<string, string>();

  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
    removeItem: (key) => {
      entries.delete(key);
    },
  };
}
