/**
 * The platform resolver, asked once per request and never again.
 *
 * `lookup` RATHER THAN `resolve4` AND `resolve6`, and the difference is the one that matters here.
 * `resolve*` queries DNS directly and ignores everything else the machine would have used: the
 * hosts file, mDNS, an NSS module. A check performed against what DNS says, followed by a
 * connection made through what the operating system says, is a check of a different answer than
 * the one that will be used, which is the shape of the whole defect this file is part of.
 * `lookup` with `all` asks the same question the connection will ask.
 */

import { lookup } from 'node:dns/promises';
import type { IAddressResolver } from '../../application/ports/proxy-outbound.port';

/** Resolves a hostname the way the platform would for a connection. */
export class NodeAddressResolver implements IAddressResolver {
  /** @inheritdoc */
  async resolve(hostname: string): Promise<readonly string[]> {
    try {
      const answers = await lookup(hostname, { all: true, verbatim: true });

      return answers.map((answer) => answer.address);
    } catch {
      // A NAME THAT DOES NOT RESOLVE PRODUCES AN EMPTY LIST AND NOT AN EXCEPTION, because the
      // policy above has one answer for a name with no address and it is a refusal. Letting the
      // resolver's own error escape would give that case a different shape than every other
      // refusal, and a different shape is a different code path to get right.
      return [];
    }
  }
}
