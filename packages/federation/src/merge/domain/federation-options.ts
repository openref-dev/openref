import { ErrorCode, InvalidOptionsError, isFederationServiceId } from '@openref/core';
import type { IRDocument, IRInfo, IRServer } from '@openref/core';

/**
 * What a merge is asked to do, and what it refuses before it starts, per SPEC 15.
 *
 * EVERYTHING HERE IS CHECKED BEFORE THE FIRST DOCUMENT IS READ. A service id becomes part of a
 * node id, and a node id becomes a page address and a file name; a prefix becomes part of a URL
 * path. Both therefore leave this package and land in places that cannot re-check them, so they
 * are an allowlist of what the value is made of rather than a denylist of what it must not be,
 * which is the shape `T043` arrived at after a denylist over generator grammar leaked three
 * times.
 */

/** How a name claimed by more than one service is resolved, per SPEC 15. */
export type FederationConflictMode = 'namespace' | 'fail' | 'first-wins';

/** Every mode, in the order SPEC 15 prints them. Exported so a caller can validate its own input. */
export const FEDERATION_CONFLICT_MODES: readonly FederationConflictMode[] = [
  'namespace',
  'fail',
  'first-wins',
];

/** The default, which is the one SPEC 15's example configures. */
export const DEFAULT_CONFLICT_MODE: FederationConflictMode = 'namespace';

/**
 * Identity and mount of one configured entry, with or without a document.
 *
 * IT IS THE PART THE VALIDATION READS, AND IT IS A NAMED TYPE SO THAT THE MERGE AND THE REMOTE
 * LIFECYCLE OF `T045` ARE HELD TO ONE RULE. A remote is a service whose document has not arrived
 * yet: its id and prefix carry exactly the obligations a merge service's do, because both end up
 * in node ids, page addresses and file names. Two validators over one grammar is how the two
 * that disagreed came to exist elsewhere in this repository.
 */
export interface FederationServiceIdentity {
  /**
   * Identity of the service, which every node id of this service is prefixed with.
   *
   * It is not read from the document, because a document's own `id` is chosen by whoever wrote
   * the document and two remotes can easily arrive with the same one. The federation
   * configuration names the service, and this is that name.
   */
  readonly id: string;
  /**
   * Path prefix the service is mounted under, such as `/billing`.
   *
   * APPLIED TO EVERY ADDRESS OF THE SERVICE, NOT ONLY TO A CLASHING ONE. A prefix is where the
   * service is, so an address that carries it on one page and not on another would be two
   * different claims about one endpoint. A conflict between two services that declared no prefix
   * is a separate mechanism, and it is `onConflict`.
   */
  readonly prefix?: string;
}

/** One service taking part in a merge: its identity, its document and where it is mounted. */
export interface FederationService extends FederationServiceIdentity {
  /** The service's normalized document. */
  readonly document: IRDocument;
}

/** What the merged document is, beyond the services it is made of. */
export interface MergeDocumentsOptions {
  /** `IRDocument.id` of the merged document. */
  readonly id: string;
  /** Header of the merged document. Supplied rather than derived: no service's title is the whole. */
  readonly info: IRInfo;
  /**
   * Servers of the merged document, which is the gateway, when the caller knows one.
   *
   * DEFAULTS TO NONE, AND THAT IS NOT AN OVERSIGHT. Each service keeps its own servers on its
   * `IRService` entry, so nothing is lost, and a merged document is not served from any of them.
   * Filling this with the union of the services' servers would hand the console a host chosen by
   * sort order and send a reader's request to a service that never had the endpoint.
   */
  readonly servers?: readonly IRServer[];
  /** Resolution policy for a name two services claim. Defaults to `namespace`. */
  readonly onConflict?: FederationConflictMode;
}

/** Longest service id, so a merged node id stays a name a filesystem and a URL both keep. */
const SERVICE_ID_MAX = 64;

/** One segment of a mount prefix: the unreserved set of RFC 3986 and nothing else. */
const PREFIX_SEGMENT = /^[A-Za-z0-9._~-]+$/;

/** Longest mount prefix, counted in characters, for the reason the id has a bound. */
const PREFIX_MAX = 256;

/**
 * Refuses a service list that cannot be merged.
 *
 * The parameter is the identity subset rather than the full service, so the remote lifecycle
 * can hold its configured remotes to the same rule before any document exists to attach.
 *
 * @param services - The services as the caller supplied them, in any order
 * @throws {InvalidOptionsError} When the list is empty, an id is unusable, or an id is repeated
 */
export function validateServices(services: readonly FederationServiceIdentity[]): void {
  if (services.length === 0) {
    throw new InvalidOptionsError(
      'federation has no services to merge; a merge of nothing is not an empty document, ' +
        'it is a configuration that never named a remote',
      ErrorCode.CONFIG_INVALID_OPTIONS,
    );
  }

  const seen = new Map<string, number>();

  for (const [index, service] of services.entries()) {
    validateServiceId(service.id, index);
    validatePrefix(service.id, service.prefix);

    const first = seen.get(service.id);
    if (first !== undefined) {
      throw new InvalidOptionsError(
        `two services are configured with the id "${service.id}", at positions ` +
          `${String(first)} and ${String(index)}; a service id is what every node of that ` +
          'service is addressed by, so two of them would merge into one service that is neither',
        ErrorCode.CONFIG_INVALID_OPTIONS,
        undefined,
        { serviceId: service.id },
      );
    }

    seen.set(service.id, index);
  }
}

/**
 * Refuses a mode string that is not one of the three.
 *
 * @param mode - Whatever the caller configured, or nothing
 * @returns The mode to merge under
 * @throws {InvalidOptionsError} When the value is not a mode SPEC 15 defines
 */
export function resolveConflictMode(
  mode: FederationConflictMode | undefined,
): FederationConflictMode {
  if (mode === undefined) return DEFAULT_CONFLICT_MODE;

  if (!FEDERATION_CONFLICT_MODES.includes(mode)) {
    throw new InvalidOptionsError(
      `onConflict is "${mode}", which is not one of ${FEDERATION_CONFLICT_MODES.join(', ')}`,
      ErrorCode.CONFIG_INVALID_OPTIONS,
      undefined,
      { onConflict: mode },
    );
  }

  return mode;
}

/**
 * Checks one service id against the allowlist.
 *
 * @param id - The configured id
 * @param index - Position in the configured list, so a message names the entry
 * @throws {InvalidOptionsError} When the id is empty, too long, or carries anything else
 */
function validateServiceId(id: string, index: number): void {
  if (id.length > SERVICE_ID_MAX) {
    throw new InvalidOptionsError(
      `the service id at position ${String(index)} is ${String(id.length)} characters, and the ` +
        `limit is ${String(SERVICE_ID_MAX)}; it is prefixed onto every node id of the service ` +
        'and a node id becomes a file name',
      ErrorCode.CONFIG_INVALID_OPTIONS,
      undefined,
      { index },
    );
  }

  // THE ALPHABET IS `core`'s ANSWER AND NOT A SECOND ONE HERE. SPEC 15 makes the `<serviceId>_`
  // node prefix separable only while a service id is confined to the alphabet a derived node id
  // uses, and `isFederationServiceId` is where that condition is written down. A stricter copy in
  // this file would be a second rule about one thing, which is how the two that disagreed came to
  // exist elsewhere in this repository.
  if (!isFederationServiceId(id)) {
    throw new InvalidOptionsError(
      `the service id at position ${String(index)} is ${JSON.stringify(id)}, and a service id ` +
        'is lower case letters, digits and hyphens; it is prefixed onto every node id, which ' +
        'becomes a page address and a file name, and SPEC 15 makes that prefix separable only ' +
        'while the id introduces no character the node id space does not have',
      ErrorCode.CONFIG_INVALID_OPTIONS,
      undefined,
      { index },
    );
  }
}

/**
 * Checks one mount prefix against the allowlist.
 *
 * @param serviceId - Service the prefix belongs to, so a message names it
 * @param prefix - The configured prefix, or nothing
 * @throws {InvalidOptionsError} When the prefix is not an absolute path of ordinary segments
 */
function validatePrefix(serviceId: string, prefix: string | undefined): void {
  if (prefix === undefined) return;

  const refuse = (reason: string): never => {
    throw new InvalidOptionsError(
      `the prefix ${JSON.stringify(prefix)} of service "${serviceId}" ${reason}`,
      ErrorCode.CONFIG_INVALID_OPTIONS,
      undefined,
      { serviceId },
    );
  };

  if (prefix.length > PREFIX_MAX) {
    refuse(`is ${String(prefix.length)} characters, and the limit is ${String(PREFIX_MAX)}`);
  }

  if (!prefix.startsWith('/')) {
    refuse('is not an absolute path; a mount prefix starts with "/"');
  }

  if (prefix === '/') {
    refuse('mounts the service where it already is, which is not a prefix but a no-op');
  }

  if (prefix.endsWith('/')) {
    refuse('ends with "/", which would put an empty segment in every address it prefixes');
  }

  for (const segment of prefix.slice(1).split('/')) {
    if (segment === '') refuse('has an empty segment, so it is not one path');
    if (segment === '.' || segment === '..')
      refuse('has a path grammar segment rather than a name');
    if (!PREFIX_SEGMENT.test(segment)) {
      refuse(
        `has the segment ${JSON.stringify(segment)}, and a segment is the unreserved set of ` +
          'RFC 3986: letters, digits, and the characters . _ ~ -',
      );
    }
  }
}
