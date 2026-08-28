/**
 * Putting one proxied request on the wire, to one address, following nothing.
 *
 * `node:http` AND `node:https` RATHER THAN `fetch`, AND THE REASON IS THE ADDRESS. The whole
 * defence against DNS rebinding is that the connection is opened to the address the policy
 * checked, and `fetch` offers no way to say which address that is: it takes a url, hands the
 * hostname to the platform, and whatever comes back the second time is what it connects to. The
 * `lookup` option of `net.connect` is the seam that closes it, and `http.request` passes it
 * through. The url still carries the hostname, so TLS still validates the certificate against the
 * name and the `Host` header is still the API's own.
 *
 * THE LOOKUP RE-CHECKS THE ADDRESS RATHER THAN TRUSTING ITS CALLER, which is the second half of
 * SPEC 14.5's rebinding clause. The policy checked this address a moment ago; this checks it
 * again, at the instant of connecting, and refuses a lookup for any host other than the one the
 * request names. Two checks of one value look redundant until the value arrives from somewhere
 * else, and this port is public enough that it will.
 */

import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { ErrorCode, ProxyBlockedError, RunnerError } from '@openref/core';
import { addressRefusal, parseIpv4 } from '@openref/core';
import type {
  IOutboundHttp,
  OutboundRequest,
  OutboundResponse,
} from '../../application/ports/proxy-outbound.port';

/**
 * The shape `net.connect` expects a lookup callback to answer with.
 *
 * The error and the address are declared as one required parameter each, which is what Node's own
 * `LookupFunction` says: a callback that admits `undefined` for the address is not assignable to
 * it, and widening the type here to look accommodating is how this stopped compiling the first
 * time. A refusal passes an error and an empty string, because there is no address to pass.
 */
type LookupCallback = (error: Error | null, address: string, family: number) => void;

/** Sends a request with Node's own http client, to a pinned address. */
export class NodeOutboundHttp implements IOutboundHttp {
  /** @inheritdoc */
  async send(outbound: OutboundRequest): Promise<OutboundResponse> {
    const url = new URL(outbound.url);
    const secure = url.protocol === 'https:';
    const send = secure ? httpsRequest : httpRequest;

    const refusal = addressRefusal(outbound.address);
    if (refusal !== null) {
      throw new ProxyBlockedError(
        `the proxy refused to connect to ${outbound.address}, which is ${refusal}`,
        ErrorCode.RUN_PROXY_HOST_BLOCKED,
        undefined,
        { address: outbound.address },
      );
    }

    const family = parseIpv4(outbound.address) === null ? 6 : 4;

    return new Promise<OutboundResponse>((resolve, reject) => {
      const client = send(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port === '' ? (secure ? 443 : 80) : Number(url.port),
          path: `${url.pathname}${url.search}`,
          method: outbound.method,
          headers: outbound.headers,
          // NEVER FOLLOWED, AND THE CLIENT CANNOT FOLLOW ONE ANYWAY. `http.request` returns the
          // 3xx as the response, unlike `fetch`, so this is a property of the client rather than
          // an option that could be set the wrong way. It is stated here because the next person
          // to reach for `fetch` needs to know it was the reason.
          lookup: (hostname: string, _options: unknown, callback: LookupCallback): void => {
            if (hostname !== url.hostname) {
              callback(
                new ProxyBlockedError(
                  `the connection asked to resolve ${hostname} while the request names ${url.hostname}`,
                  ErrorCode.RUN_PROXY_HOST_BLOCKED,
                ),
                '',
                family,
              );
              return;
            }

            const second = addressRefusal(outbound.address);
            if (second !== null) {
              callback(
                new ProxyBlockedError(
                  `the address ${outbound.address} is ${second}`,
                  ErrorCode.RUN_PROXY_HOST_BLOCKED,
                ),
                '',
                family,
              );
              return;
            }

            callback(null, outbound.address, family);
          },
        },
        (response) => {
          const chunks: Buffer[] = [];
          let size = 0;
          let aborted = false;

          response.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > outbound.maxResponseBytes) {
              aborted = true;
              response.destroy();
              reject(
                new RunnerError(
                  `the API answered with more than ${String(outbound.maxResponseBytes)} bytes`,
                  ErrorCode.RUN_RESPONSE_TOO_LARGE,
                ),
              );
              return;
            }

            chunks.push(chunk);
          });

          response.on('end', () => {
            if (aborted) return;

            resolve({
              status: response.statusCode ?? 0,
              statusText: response.statusMessage ?? '',
              headers: headerPairs(response.headers),
              body: Buffer.concat(chunks).toString('utf8'),
            });
          });

          response.on('error', reject);
        },
      );

      client.setTimeout(outbound.timeoutMs, () => {
        client.destroy(
          new RunnerError(
            `the API did not answer inside ${String(outbound.timeoutMs)}ms`,
            ErrorCode.RUN_TIMEOUT,
          ),
        );
      });

      client.on('error', reject);

      if (outbound.body !== null) client.write(outbound.body);
      client.end();
    });
  }
}

/**
 * Node's header bag as ordered pairs, with a repeated header repeated.
 *
 * @param headers - What the response carried
 * @returns One pair per value
 */
function headerPairs(
  headers: Readonly<Record<string, string | string[] | undefined>>,
): (readonly [string, string])[] {
  const pairs: (readonly [string, string])[] = [];

  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) pairs.push([name, item]);
      continue;
    }

    pairs.push([name, value]);
  }

  return pairs;
}
