/**
 * Which IP addresses the proxy is allowed to reach, and it is a very short list.
 *
 * THE POLICY IS AN ALLOWLIST OF ADDRESS SPACE RATHER THAN A LIST OF FORBIDDEN RANGES, and that is
 * the whole design. A denylist of the ranges everyone remembers, 10/8, 127/8, 169.254/16, is a
 * check whose correctness depends on somebody having remembered enough: carrier grade NAT,
 * 0.0.0.0/8, the IPv4 broadcast address, multicast, the two IPv6 forms that carry an IPv4 address
 * inside them, and whatever the next registry allocation is. Every one of them is a hop to
 * something that is not the internet. So this asks the opposite question. An address is refused
 * unless it is global unicast, which for IPv4 means it is in none of the special purpose blocks
 * IANA has assigned, and for IPv6 means it is inside `2000::/3` and nothing else.
 *
 * THE TWO IPv6 FORMS THAT CARRY AN IPv4 ADDRESS ARE READ AS THAT ADDRESS. `::ffff:127.0.0.1` is
 * the mapped form and `::7f00:1` the compatible one, and both reach the loopback interface of the
 * machine running this process while looking nothing like `127.0.0.1` to a check that compares
 * strings. They are refused by `2000::/3` on their own, and they are still detected on purpose:
 * the reason a refusal gives is what a person acts on, and "the mapped form of 127.0.0.1" is a
 * different sentence from "not a global unicast address".
 *
 * A HOSTNAME NEVER REACHES THIS FILE. Resolution is somebody else's job, because it needs a
 * network and this needs to be a pure function. What arrives here is an address.
 */

/** What is wrong with an address, or null when nothing is. */
export type AddressRefusal = string | null;

/** One special purpose IPv4 block, with the words a refusal uses for it. */
interface Ipv4Block {
  /** First octet, and the mask width, as a prefix comparison. */
  readonly prefix: readonly number[];
  readonly bits: number;
  readonly reason: string;
}

/**
 * The IPv4 blocks that are not global unicast, from the IANA special purpose registry.
 *
 * NAMED RATHER THAN SUMMARIZED, so that a refusal says which one and a reader of this list can
 * check it against the registry line by line.
 */
const IPV4_BLOCKS: readonly Ipv4Block[] = [
  { prefix: [0], bits: 8, reason: 'this network, 0.0.0.0/8' },
  { prefix: [10], bits: 8, reason: 'a private network, 10.0.0.0/8' },
  { prefix: [100, 64], bits: 10, reason: 'carrier grade NAT space, 100.64.0.0/10' },
  {
    prefix: [127],
    bits: 8,
    reason: 'the loopback of the machine this process runs on, 127.0.0.0/8',
  },
  {
    prefix: [169, 254],
    bits: 16,
    reason: 'link local space, 169.254.0.0/16, where a cloud instance metadata service lives',
  },
  { prefix: [172, 16], bits: 12, reason: 'a private network, 172.16.0.0/12' },
  { prefix: [192, 0, 0], bits: 24, reason: 'IETF protocol assignments, 192.0.0.0/24' },
  { prefix: [192, 0, 2], bits: 24, reason: 'documentation space, 192.0.2.0/24' },
  {
    prefix: [192, 88, 99],
    bits: 24,
    reason: 'the deprecated 6to4 relay anycast block, 192.88.99.0/24',
  },
  { prefix: [192, 168], bits: 16, reason: 'a private network, 192.168.0.0/16' },
  { prefix: [198, 18], bits: 15, reason: 'benchmarking space, 198.18.0.0/15' },
  { prefix: [198, 51, 100], bits: 24, reason: 'documentation space, 198.51.100.0/24' },
  { prefix: [203, 0, 113], bits: 24, reason: 'documentation space, 203.0.113.0/24' },
  { prefix: [224], bits: 4, reason: 'multicast space, 224.0.0.0/4' },
  { prefix: [240], bits: 4, reason: 'reserved space, 240.0.0.0/4, which includes 255.255.255.255' },
];

/**
 * Reads a dotted quad, refusing every spelling that is not four plain decimal octets.
 *
 * LEADING ZEROS ARE REFUSED RATHER THAN READ. `0177.0.0.1` is octal to `inet_aton` and decimal to
 * a parser that strips zeros, which is to say the same text names two different hosts depending on
 * who reads it. A url with one in it does not get a second opinion here.
 *
 * @param text - The candidate
 * @returns Four octets, or null when the text is not a dotted quad
 */
export function parseIpv4(text: string): number[] | null {
  const parts = text.split('.');
  if (parts.length !== 4) return null;

  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    if (part.length > 1 && part.startsWith('0')) return null;

    const value = Number(part);
    if (value > 255) return null;
    octets.push(value);
  }

  return octets;
}

/**
 * Reads an IPv6 address, including the two forms that end in a dotted quad.
 *
 * @param text - The candidate, without brackets and without a zone id
 * @returns Eight groups of sixteen bits, or null when the text is not an IPv6 address
 */
export function parseIpv6(text: string): number[] | null {
  if (text.includes('%')) return null;

  const halves = text.split('::');
  if (halves.length > 2) return null;

  /**
   * Reads one side of a `::`, expanding a trailing dotted quad into two groups.
   *
   * @param part - The text of that side
   * @returns The groups, or null when any piece is not a group
   */
  const groupsOf = (part: string): number[] | null => {
    if (part === '') return [];

    const pieces = part.split(':');
    const groups: number[] = [];

    for (const [index, piece] of pieces.entries()) {
      if (index === pieces.length - 1 && piece.includes('.')) {
        const quad = parseIpv4(piece);
        if (quad === null) return null;
        groups.push(((quad[0] ?? 0) << 8) | (quad[1] ?? 0), ((quad[2] ?? 0) << 8) | (quad[3] ?? 0));
        continue;
      }

      if (!/^[\da-fA-F]{1,4}$/.test(piece)) return null;
      groups.push(Number.parseInt(piece, 16));
    }

    return groups;
  };

  const head = groupsOf(halves[0] ?? '');
  if (head === null) return null;

  if (halves.length === 1) return head.length === 8 ? head : null;

  const tail = groupsOf(halves[1] ?? '');
  if (tail === null) return null;

  const missing = 8 - head.length - tail.length;
  if (missing < 1) return null;

  return [...head, ...Array.from({ length: missing }, () => 0), ...tail];
}

/**
 * Whether four octets fall inside a block.
 *
 * @param octets - The address
 * @param block - The block
 * @returns True when the address is in it
 */
function inBlock(octets: readonly number[], block: Ipv4Block): boolean {
  let remaining = block.bits;

  for (const [index, expected] of block.prefix.entries()) {
    const width = Math.min(8, remaining);
    const mask = width === 0 ? 0 : (0xff << (8 - width)) & 0xff;
    if (((octets[index] ?? 0) & mask) !== (expected & mask)) return false;
    remaining -= width;
    if (remaining <= 0) return true;
  }

  return true;
}

/**
 * Why an IPv4 address may not be reached, or null when it may.
 *
 * @param octets - The four octets
 * @returns The reason, or null
 */
function ipv4Refusal(octets: readonly number[]): AddressRefusal {
  for (const block of IPV4_BLOCKS) {
    if (inBlock(octets, block)) return block.reason;
  }

  return null;
}

/** How the four octets are written back into a message. */
function ipv4Text(octets: readonly number[]): string {
  return octets.join('.');
}

/**
 * Why an address may not be reached, or null when it may.
 *
 * @param address - An IP address literal, without brackets
 * @returns A sentence naming what the address is, or null when it is global unicast
 *
 * @example
 * addressRefusal('169.254.169.254'); // 'link local space, ...'
 * addressRefusal('93.184.216.34'); // null
 */
export function addressRefusal(address: string): AddressRefusal {
  const trimmed = address.trim().replace(/^\[|\]$/g, '');

  const quad = parseIpv4(trimmed);
  if (quad !== null) return ipv4Refusal(quad);

  const groups = parseIpv6(trimmed);
  if (groups === null) {
    // NOT AN ADDRESS AT ALL IS A REFUSAL AND NEVER A PASS. Everything that reaches here has been
    // resolved or read out of a url, so text that parses as neither is something this code does
    // not understand, and the fail closed policy of SPEC 14.5 has one answer for that.
    return `'${address}' is not an IP address this proxy can classify`;
  }

  const leading = groups.slice(0, 5);
  const allZero = leading.every((group) => group === 0);

  // The mapped form, `::ffff:a.b.c.d`, and the compatible form, `::a.b.c.d`. Both carry an IPv4
  // address into an IPv6 literal, and both reach whatever that address reaches.
  if (allZero && (groups[5] === 0xffff || groups[5] === 0)) {
    const octets = [
      ((groups[6] ?? 0) >> 8) & 0xff,
      (groups[6] ?? 0) & 0xff,
      ((groups[7] ?? 0) >> 8) & 0xff,
      (groups[7] ?? 0) & 0xff,
    ];
    const form = groups[5] === 0xffff ? 'IPv4 mapped' : 'IPv4 compatible';

    // `::` and `::1` are the unspecified and loopback addresses rather than an embedded quad, and
    // they are named as themselves.
    if (groups[5] === 0 && (groups[6] ?? 0) === 0 && (groups[7] ?? 0) <= 1) {
      return (groups[7] ?? 0) === 1 ? 'the IPv6 loopback, ::1' : 'the unspecified IPv6 address, ::';
    }

    const refusal = ipv4Refusal(octets);
    if (refusal !== null) return `the ${form} form of ${ipv4Text(octets)}, which is ${refusal}`;

    // A MAPPED FORM OF A PUBLIC ADDRESS IS STILL REFUSED, and the reason is that unwrapping it
    // would be this code deciding that two spellings are one host. The proxy connects to the
    // address a resolver returned, in the family it returned it in, and a url spelling an IPv4
    // address as IPv6 is a url with nothing to gain from being accepted.
    return (
      `the ${form} form of ${ipv4Text(octets)}, which this proxy refuses in either family ` +
      'rather than unwrapping into an address it did not resolve'
    );
  }

  // GLOBAL UNICAST IS `2000::/3` AND THE REST IS REFUSED BY NOT BEING IT. Unique local `fc00::/7`,
  // link local `fe80::/10` and multicast `ff00::/8` are all outside it, so each is refused without
  // a rule of its own, which is the property an allowlist of address space has and a denylist
  // does not.
  const first = groups[0] ?? 0;
  if ((first & 0xe000) === 0x2000) return null;

  if ((first & 0xfe00) === 0xfc00) return 'a unique local address, fc00::/7';
  if ((first & 0xffc0) === 0xfe80) return 'a link local address, fe80::/10';
  if ((first & 0xff00) === 0xff00) return 'a multicast address, ff00::/8';

  return `an IPv6 address outside global unicast space, which is 2000::/3`;
}

/**
 * Whether a host string is already an address rather than a name to resolve.
 *
 * @param host - Host component of a url, brackets and all
 * @returns True when it is an IP literal
 */
export function isAddressLiteral(host: string): boolean {
  const trimmed = host.replace(/^\[|\]$/g, '');

  return parseIpv4(trimmed) !== null || parseIpv6(trimmed) !== null;
}
