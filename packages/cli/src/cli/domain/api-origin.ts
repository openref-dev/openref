/**
 * The API root a token bearing request is allowed to be sent to, parsed before one is formed.
 *
 * THIS IS THE OTHER HALF OF THE ADDRESS THAT `RepositorySlug` GUARDS, AND IT WAS UNGUARDED.
 * `GITHUB_API_URL` was concatenated into every request as written, with no check of its scheme or
 * its host, so whoever could set that variable chose where a write scoped token was delivered. The
 * repository half was parsed; this half was not, which is SPEC 19's eleventh claim.
 *
 * IT IS A VALUE AND NOT A STRING, FOR THE SAME REASON THE SLUG IS. `GitHubCommentTarget` takes an
 * `ApiOrigin`, and the only way to obtain one is `parseApiOrigin`, so no call site anybody writes
 * later can pass the raw variable straight through.
 *
 * HTTPS ONLY, WITH LOOPBACK OVER HTTP AS THE ONE EXCEPTION. A token on the wire in clear text is a
 * token given away, so `https` is the rule. `http` is admitted only for `127.0.0.1`, `::1` and
 * `localhost`, which is where this project's fake GitHub listens: a suite that could not speak to
 * its own fake would be a suite that proves nothing about the real path, and a loopback address
 * leaves the machine on no network at all.
 *
 * IT REFUSES RATHER THAN REPAIRS, LIKE THE SLUG. Nothing here adds a missing scheme, follows a
 * redirect, or resolves a host: a bare host, another scheme, a string that is not a URL, and an
 * address carrying credentials of its own are each a usage error, named by the variable that
 * supplied them.
 */

/** One API root, validated, with its trailing slashes already gone. */
export interface ApiOrigin {
  /** The root every request path is appended to, with no trailing slash. */
  readonly url: string;
}

/**
 * The hosts an `http` API root is allowed to name.
 *
 * All three are the local machine. `localhost` is here because that is how a developer writes it,
 * and it resolves to one of the two literals above on every platform this runs on.
 */
export const LOOPBACK_HOSTS: readonly string[] = ['127.0.0.1', '[::1]', '::1', 'localhost'];

/**
 * Parses an API root, or says why a token will not be sent to it.
 *
 * @param value - The raw value, as `GITHUB_API_URL` supplied it
 * @param source - The name of the variable, so the refusal points at what to fix
 * @returns The origin, or the one message that stopped it
 */
export function parseApiOrigin(
  value: string,
  source = 'GITHUB_API_URL',
): ApiOrigin | { readonly usageError: string } {
  const refusal = (why: string): { readonly usageError: string } => ({
    usageError:
      `${source} ${JSON.stringify(value)} ${why}. A request carrying GITHUB_TOKEN is only ever ` +
      'sent to an https origin, or to http on the loopback address, per SPEC 19.11',
  });

  if (value.trim() === '') return refusal('is empty');

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return refusal('is not a URL at all, so nothing here can say which host it names');
  }

  if (parsed.username !== '' || parsed.password !== '') {
    return refusal('carries credentials of its own inside the address, which nobody asked for');
  }

  if (parsed.protocol === 'https:') return { url: trimSlashes(parsed) };

  if (parsed.protocol !== 'http:') {
    return refusal(`names the scheme ${parsed.protocol.replace(':', '')} rather than https`);
  }

  if (!LOOPBACK_HOSTS.includes(parsed.hostname)) {
    return refusal(
      `names http for the host ${JSON.stringify(parsed.hostname)}, and http is admitted only for ` +
        'the loopback address the test fake listens on',
    );
  }

  return { url: trimSlashes(parsed) };
}

/** One parsed URL as the root of a path, with the trailing slashes a root never needs. */
function trimSlashes(url: URL): string {
  return url.href.replace(/\/+$/, '');
}
