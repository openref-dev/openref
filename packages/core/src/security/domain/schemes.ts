/**
 * The URL schemes this project admits, in one place rather than nine.
 *
 * WHY IT IS A MODULE AND NOT A LITERAL AT EACH SITE. Before the pre-M4 review the pair
 * `http:`/`https:` was spelled out nine separate times across five packages, and one more answer to
 * the same question was not spelled anywhere at all: the markdown sanitizer set no scheme list, so
 * what a document could link to was whatever `DOMPurify` shipped that week. Nine copies of a
 * decision drift the way two gates answering one question drift, which this repository has a
 * standing rule about; a tenth copy living in a dependency is worse, because it changes without a
 * commit here.
 *
 * WHAT THIS MODULE DOES NOT DO IS DECIDE POLICY. The sites differ on purpose and keep their own
 * answers: the proxy speaks these two, the GitHub API root and an OAuth2 endpoint take https and
 * make one exception for loopback, and a source link takes an editor scheme that has no business
 * anywhere else. What they share is the vocabulary, so a site that means "the two schemes an API is
 * served over" says so by naming this rather than by writing the pair again.
 */

/** The two schemes an HTTP API is served over. */
export const HTTP_SCHEMES = ['http:', 'https:'] as const;

/** One of the two schemes an HTTP API is served over. */
export type HttpScheme = (typeof HTTP_SCHEMES)[number];

/**
 * Reports whether a parsed url is served over HTTP at all.
 *
 * @param url - A parsed url
 * @returns True when its scheme is `http:` or `https:`
 *
 * @example
 * isHttpUrl(new URL('https://api.example.com')); // true
 * isHttpUrl(new URL('ftp://example.com'));       // false
 */
export function isHttpUrl(url: URL): boolean {
  return HTTP_SCHEMES.some((scheme) => scheme === url.protocol);
}

/**
 * The hosts a browser already treats as a secure context without https.
 *
 * The exception exists because an authorization server on a developer's own machine is the case a
 * try-it console meets most, and refusing it would refuse the ordinary local setup rather than an
 * attack. Shared so the two places that make it do not come to disagree about what loopback means.
 */
export const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]', '::1'] as const;

/**
 * Whether a url may be fetched or handed a credential.
 *
 * HTTPS, OR HTTP ON A LOOPBACK HOST, and it is asked of every address a flow uses rather than only
 * of the ones a discovery document supplied. SPEC 14.4 carried this sentence about discovery alone
 * until the pre-M4 review, and a flow the OpenAPI document declared went around it: measured,
 * `clientCredentials` built a request to `http://evil.example/token` carrying the client secret in
 * a `Basic` header, and a code exchange built one to `http://169.254.169.254/token` carrying the
 * PKCE verifier. A specification is somebody else's document, and its `tokenUrl` arrives by the
 * same road as an `openIdConnectUrl`.
 *
 * @param url - A parsed url
 * @returns True when a credential may be sent to it
 *
 * @example
 * isSecureCredentialUrl(new URL('https://id.example.com/token')); // true
 * isSecureCredentialUrl(new URL('http://localhost:9000/token'));  // true
 * isSecureCredentialUrl(new URL('http://evil.example/token'));    // false
 */
export function isSecureCredentialUrl(url: URL): boolean {
  if (url.protocol === 'https:') return true;
  if (url.protocol !== 'http:') return false;
  return LOOPBACK_HOSTS.some((host) => host === url.hostname);
}

/**
 * What a link in a document's own prose may point at.
 *
 * `http`, `https` and `mailto`, plus everything that names no scheme at all, which is what keeps a
 * relative link and a fragment working. The trailing alternatives are the shape `DOMPurify`'s own
 * default uses for exactly that reason and are kept deliberately: a value that is not a scheme has
 * to pass, or every `[text](#anchor)` in every description stops being a link.
 *
 * NARROWER THAN THE DEFAULT, AND THE DIFFERENCE IS THE POINT. `ftp`, `tel`, `sms`, `callto`, `cid`,
 * `xmpp` and `matrix` were reaching an `href` because nobody had chosen them. None of them is a
 * scheme an API reference has a use for, and each is one more handler a document can hand the
 * reader's operating system.
 */
export const DOCUMENT_LINK_SCHEMES = /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i;
