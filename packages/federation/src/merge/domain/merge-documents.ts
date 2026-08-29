import {
  ErrorCode,
  FederationError,
  federatedSchemaId,
  finalizeDocument,
  hash,
} from '@openref/core';
import type {
  IRDocument,
  IRNavNode,
  IRNode,
  IRSchema,
  IRSecurityScheme,
  IRService,
} from '@openref/core';
import { applyPrefix, servicePrefix, type AddressStyle } from './address';
import {
  mergeHealth,
  mergeKind,
  mergeRelationships,
  serviceRecord,
  type HealthSource,
} from './document-parts';
import {
  resolveConflictMode,
  validateServices,
  type FederationConflictMode,
  type FederationService,
  type MergeDocumentsOptions,
} from './federation-options';
import {
  allocateUnique,
  escapeIdentifier,
  identifierKey,
  namespaceIdentifier,
  resolveNames,
  type NameClaim,
  type NameSpaceRules,
  type ResolvedName,
} from './name-allocation';
import {
  compareText,
  sortRenames,
  type MergeDeduplication,
  type MergeRename,
  type MergeRenameKind,
  type MergeRenameReason,
  type MergeResult,
} from './merge-report';
import { mismatchedKeys, unresolvedReferences, type UnresolvedReference } from './references';
import { classifySchemas, type SchemaClass, type SchemaEntry } from './schema-identity';
import { rewriteNode, rewriteSchema, type NodeIdentity, type RewriteMaps } from './rewrite';

/**
 * The merge engine of SPEC 15: several normalized documents in, one normalized document out.
 *
 * THE ORDER OF THE SERVICES IS THE SORTED ORDER OF THEIR IDS, NEVER THE CONFIGURED ORDER. The
 * task's own done-when asks for output that is identical under shuffled remote ordering, and a
 * merge that read the configured order would have every tie broken by whichever remote answered
 * first. Sorting by id is what makes "the first service" a fact about the configuration rather
 * than about a network.
 *
 * WHAT IS DECIDED BEFORE ANYTHING IS BUILT. Every name is planned first, in four spaces: schema
 * ids, node ids, addresses and security scheme ids. Only then is a single node rewritten, because
 * a node points at schemas and at other nodes and a rewrite that ran while the plan was still
 * being made would carry whatever the plan happened to hold at that moment.
 *
 * IT CHECKS ITS OWN OUTPUT AND REFUSES A BROKEN ONE. Rewriting is field by field, so a field added
 * to the IR and not added there would carry a stale id into the merged document, where it renders
 * as a missing schema or a dead link. `unresolvedReferences` walks the result generically and the
 * merge refuses to return a document in which something that resolved in a source no longer does.
 */

/** How one service's names map onto the merged ones, while the plan is still being written. */
interface MutableMaps {
  readonly nodeIds: Map<string, string>;
  readonly schemaIds: Map<string, string>;
  readonly schemeIds: Map<string, string>;
}

/** One node awaiting its merged id: which service it came from, and whether it is a webhook. */
interface NodeSubject {
  readonly serviceId: string;
  readonly sourceId: string;
  readonly node: IRNode;
  readonly kind: 'node' | 'webhook';
}

/** One address awaiting its merged form. */
interface AddressSubject {
  readonly serviceId: string;
  readonly sourceId: string;
  readonly style: AddressStyle;
  /** The address as the service's own document wrote it, which is what a rename reports moving. */
  readonly sourceAddress: string;
  /** Method of an operation. Absent for a channel, whose address stands alone. */
  readonly method?: string;
}

/** One security scheme value, and every service that declared it under this id. */
interface SchemeSubject {
  readonly scheme: IRSecurityScheme;
  readonly serviceIds: readonly string[];
}

/** One navigation entry awaiting its merged id. */
type NavSubject =
  | { readonly kind: 'service-group'; readonly serviceId: string }
  | { readonly kind: 'entry'; readonly serviceId: string; readonly entry: IRNavNode };

/**
 * Merges several services into one reference, per SPEC 15.
 *
 * @param services - The services, in any order; the merge sorts them by id
 * @param options - Identity and header of the merged document, and the conflict policy
 * @returns The merged document and the account of every name the merge moved
 * @throws {InvalidOptionsError} When a service id, a prefix or the mode is unusable
 * @throws {MergeConflictError} Under `fail`, when two services claim one name
 * @throws {FederationError} When the merged document's own references do not resolve
 *
 * @example
 * const { document, report } = mergeDocuments(
 *   [{ id: 'billing', document: billing }, { id: 'orders', document: orders }],
 *   { id: 'platform', info: { title: 'Platform', version: '1.0.0' } },
 * );
 */
export function mergeDocuments(
  services: readonly FederationService[],
  options: MergeDocumentsOptions,
): MergeResult {
  validateServices(services);
  const mode = resolveConflictMode(options.onConflict);
  const ordered = [...services].sort((left, right) => compareText(left.id, right.id));

  const maps = new Map<string, MutableMaps>(
    ordered.map((service) => [
      service.id,
      { nodeIds: new Map(), schemaIds: new Map(), schemeIds: new Map() },
    ]),
  );
  const renames: MergeRename[] = [];

  const schemaPlan = planSchemas(ordered, mode, maps, renames);
  planNodes(ordered, maps, renames);
  const addresses = planAddresses(ordered, mode, renames);
  const schemePlan = planSchemes(ordered, mode, maps, renames);

  const document = build(ordered, options, {
    maps,
    schemaPlan,
    addresses,
    schemes: schemePlan,
    renames,
  });

  refuseBrokenReferences(ordered, document);

  return {
    document: finalizeDocument(document),
    report: {
      serviceIds: ordered.map((service) => service.id),
      onConflict: mode,
      renames: sortRenames(renames),
      deduplicated: schemaPlan.deduplicated,
    },
  };
}

/** What planning the schema space produced. */
interface SchemaPlan {
  readonly resolved: readonly ResolvedName<SchemaClass>[];
  readonly deduplicated: readonly MergeDeduplication[];
}

/**
 * Decides what every named schema is called in the merged document.
 *
 * @param ordered - Services, sorted by id
 * @param mode - The conflict policy
 * @param maps - Per service maps, filled in as ids are decided
 * @param renames - Report entries, appended to
 * @returns The resolved classes and the deduplications worth reporting
 */
function planSchemas(
  ordered: readonly FederationService[],
  mode: FederationConflictMode,
  maps: ReadonlyMap<string, MutableMaps>,
  renames: MergeRename[],
): SchemaPlan {
  const entries: SchemaEntry[] = [];
  for (const service of ordered) {
    for (const [schemaId, schema] of service.document.schemas) {
      entries.push({ serviceId: service.id, schemaId, schema });
    }
  }

  const claims: NameClaim<SchemaClass>[] = classifySchemas(entries).map((schemaClass) => ({
    name: preferredSchemaId(schemaClass),
    serviceIds: [...new Set(schemaClass.members.map((member) => member.serviceId))].sort(
      compareText,
    ),
    subject: schemaClass,
  }));

  const resolved = resolveNames(claims, mode, federatedRules<SchemaClass>('schema'));
  const deduplicated: MergeDeduplication[] = [];

  for (const entry of resolved) {
    for (const member of entry.subject.members) {
      maps.get(member.serviceId)?.schemaIds.set(member.schemaId, entry.name);
      appendRename(renames, 'schema', member.serviceId, member.schemaId, entry, 'deduplicated');
    }

    if (entry.subject.members.length > 1) {
      deduplicated.push({
        schemaId: entry.name,
        sources: entry.subject.members.map((member) => ({
          serviceId: member.serviceId,
          schemaId: member.schemaId,
        })),
      });
    }
  }

  return { resolved, deduplicated };
}

/**
 * Decides the merged id of every node and webhook.
 *
 * EVERY ONE OF THEM MOVES, per SPEC 15, whether or not anything clashed. That is what makes a node
 * id in a federated document say which service answers it, and it is why this space is allocated
 * rather than resolved: by the time a name gets here the service has already been put in front of
 * it, so two names meeting is arithmetic and the policy has nothing to decide.
 *
 * @param ordered - Services, sorted by id
 * @param maps - Per service maps, filled in as ids are decided
 * @param renames - Report entries, appended to
 */
function planNodes(
  ordered: readonly FederationService[],
  maps: ReadonlyMap<string, MutableMaps>,
  renames: MergeRename[],
): void {
  const claims: NameClaim<NodeSubject>[] = [];

  for (const service of ordered) {
    for (const [sourceId, node] of service.document.nodes) {
      claims.push(nodeClaim(service.id, sourceId, node, 'node'));
    }
    for (const [sourceId, node] of service.document.webhooks) {
      claims.push(nodeClaim(service.id, sourceId, node, 'webhook'));
    }
  }

  for (const entry of allocateUnique(claims, identifierRules<NodeSubject>('node'))) {
    const { serviceId, sourceId, kind } = entry.subject;
    maps.get(serviceId)?.nodeIds.set(sourceId, entry.name);
    appendRename(renames, kind, serviceId, sourceId, entry, 'service-namespace');
  }
}

/** One node's claim to the merged id space. */
function nodeClaim(
  serviceId: string,
  sourceId: string,
  node: IRNode,
  kind: 'node' | 'webhook',
): NameClaim<NodeSubject> {
  return {
    name: namespaceIdentifier(sourceId, serviceId),
    serviceIds: [serviceId],
    subject: { serviceId, sourceId, node, kind },
  };
}

/**
 * Decides the merged address of every node that has one.
 *
 * A WEBHOOK HAS NO ADDRESS HERE AND IS LEFT ALONE. A webhook is what the API sends to a consumer,
 * not something the federated reference answers, so moving it under a mount prefix would state
 * that the gateway serves it. Its id is namespaced like any node's, which is all the merge owes it.
 *
 * @param ordered - Services, sorted by id
 * @param mode - The conflict policy
 * @param renames - Report entries, appended to
 * @returns Merged address by service id and then by source node id
 */
function planAddresses(
  ordered: readonly FederationService[],
  mode: FederationConflictMode,
  renames: MergeRename[],
): Map<string, Map<string, string>> {
  const claims: NameClaim<AddressSubject>[] = [];

  for (const service of ordered) {
    const prefix = service.prefix;

    for (const [sourceId, node] of service.document.nodes) {
      if (node.kind === 'operation') {
        const name = prefix === undefined ? node.path : applyPrefix(prefix, node.path, 'path');
        claims.push({
          name,
          serviceIds: [service.id],
          subject: {
            serviceId: service.id,
            sourceId,
            style: 'path',
            sourceAddress: node.path,
            method: node.method,
          },
        });
        continue;
      }

      if (node.address === undefined) continue;
      const name =
        prefix === undefined ? node.address : applyPrefix(prefix, node.address, 'channel');
      claims.push({
        name,
        serviceIds: [service.id],
        subject: {
          serviceId: service.id,
          sourceId,
          style: 'channel',
          sourceAddress: node.address,
        },
      });
    }
  }

  const addresses = new Map<string, Map<string, string>>();

  for (const entry of resolveNames(claims, mode, ADDRESS_RULES)) {
    const { serviceId, sourceId, style, sourceAddress } = entry.subject;
    let perService = addresses.get(serviceId);
    if (perService === undefined) {
      perService = new Map<string, string>();
      addresses.set(serviceId, perService);
    }
    perService.set(sourceId, entry.name);

    const kind: MergeRenameKind = style === 'path' ? 'path' : 'channel-address';
    appendRename(renames, kind, serviceId, sourceAddress, entry, 'service-prefix');
  }

  return addresses;
}

/** What planning the security scheme space produced: one merged scheme per resolved claim. */
type SchemePlan = readonly ResolvedName<SchemeSubject>[];

/**
 * Decides what every security scheme is called, and which of them are one scheme.
 *
 * TWO SERVICES DECLARING ONE SCHEME IDENTICALLY HAVE DECLARED ONE SCHEME. The console has to send
 * one credential for it, and splitting it would ask the reader for the same bearer token twice.
 * Two services declaring `bearer` with different configuration have declared two, which is the
 * case SPEC 15 names, and they are namespaced rather than merged so that neither service is
 * documented with the other's scopes.
 *
 * @param ordered - Services, sorted by id
 * @param mode - The conflict policy
 * @param maps - Per service maps, filled in as ids are decided
 * @param renames - Report entries, appended to
 * @returns One resolved claim per merged scheme, in the order they were first declared
 */
function planSchemes(
  ordered: readonly FederationService[],
  mode: FederationConflictMode,
  maps: ReadonlyMap<string, MutableMaps>,
  renames: MergeRename[],
): SchemePlan {
  const byValue = new Map<string, { scheme: IRSecurityScheme; serviceIds: string[] }>();
  const order: string[] = [];

  for (const service of ordered) {
    for (const scheme of service.document.security) {
      // The digest comes first because it is 64 characters whatever the scheme says, so the two
      // halves of the key cannot run into each other for an id that contains whatever separator
      // this line might otherwise have used.
      const key = `${hash({ ...scheme, id: '' })}${scheme.id}`;
      const existing = byValue.get(key);
      if (existing === undefined) {
        byValue.set(key, { scheme, serviceIds: [service.id] });
        order.push(key);
        continue;
      }
      if (!existing.serviceIds.includes(service.id)) existing.serviceIds.push(service.id);
    }
  }

  const claims: NameClaim<SchemeSubject>[] = order.flatMap((key) => {
    const entry = byValue.get(key);
    if (entry === undefined) return [];
    return [
      {
        name: entry.scheme.id,
        serviceIds: [...entry.serviceIds].sort(compareText),
        subject: { scheme: entry.scheme, serviceIds: [...entry.serviceIds].sort(compareText) },
      },
    ];
  });

  const resolved = resolveNames(claims, mode, federatedRules<SchemeSubject>('security scheme'));

  for (const entry of resolved) {
    for (const serviceId of entry.subject.serviceIds) {
      maps.get(serviceId)?.schemeIds.set(entry.subject.scheme.id, entry.name);
      appendRename(
        renames,
        'security-scheme',
        serviceId,
        entry.subject.scheme.id,
        entry,
        'name-conflict',
      );
    }
  }

  return resolved;
}

/** Everything the planning phase decided, handed to the building phase. */
interface BuildPlan {
  readonly maps: ReadonlyMap<string, MutableMaps>;
  readonly schemaPlan: SchemaPlan;
  readonly addresses: ReadonlyMap<string, ReadonlyMap<string, string>>;
  readonly schemes: SchemePlan;
  readonly renames: MergeRename[];
}

/**
 * Builds the merged document from the plan.
 *
 * @param ordered - Services, sorted by id
 * @param options - Identity and header of the merged document
 * @param plan - What the planning phase decided
 * @returns The merged document, not yet hashed or frozen
 */
function build(
  ordered: readonly FederationService[],
  options: MergeDocumentsOptions,
  plan: BuildPlan,
): IRDocument {
  const nodes = new Map<string, IRNode>();
  const webhooks = new Map<string, IRNode>();
  const schemas = new Map<string, IRSchema>();
  const services: IRService[] = [];
  const healthSources: HealthSource[] = [];
  const edgeSources: { edges: IRDocument['relationships']; maps: RewriteMaps }[] = [];

  for (const entry of plan.schemaPlan.resolved) {
    const [first] = entry.subject.members;
    if (first === undefined) continue;
    const maps = plan.maps.get(first.serviceId);
    if (maps === undefined) continue;
    schemas.set(entry.name, rewriteSchema(first.schema, entry.name, maps));
  }

  for (const service of ordered) {
    const maps = plan.maps.get(service.id);
    if (maps === undefined) continue;
    const addresses = plan.addresses.get(service.id);

    for (const [sourceId, node] of service.document.nodes) {
      const id = maps.nodeIds.get(sourceId) ?? sourceId;
      const address = addresses?.get(sourceId);
      const identity: { -readonly [Key in keyof NodeIdentity]: NodeIdentity[Key] } = {
        id,
        serviceId: service.id,
      };
      if (address !== undefined) identity.address = address;
      nodes.set(id, rewriteNode(node, identity, maps));
    }

    for (const [sourceId, node] of service.document.webhooks) {
      const id = maps.nodeIds.get(sourceId) ?? sourceId;
      webhooks.set(id, rewriteNode(node, { id, serviceId: service.id }, maps));
    }

    services.push(serviceRecord(service, service.prefix, maps));
    if (service.document.health !== undefined) {
      healthSources.push({ report: service.document.health, maps });
    }
    if (service.document.relationships.length > 0) {
      edgeSources.push({ edges: service.document.relationships, maps });
    }
  }

  const security = plan.schemes.map((entry) => ({ ...entry.subject.scheme, id: entry.name }));
  const navigation = buildNavigation(ordered, plan);
  const health = mergeHealth(healthSources);

  const document: { -readonly [Key in keyof IRDocument]: IRDocument[Key] } = {
    id: options.id,
    kind: mergeKind(ordered.map((service) => service.document.kind)),
    hash: '',
    info: options.info,
    servers: options.servers ?? [],
    navigation,
    nodes,
    schemas,
    security,
    relationships: mergeRelationships(edgeSources),
    webhooks,
    services,
  };

  if (health !== undefined) document.health = health;

  return document;
}

/**
 * Builds the merged navigation: one group per service, holding that service's own tree.
 *
 * "СЕРВИС СТАНОВИТСЯ РОДИТЕЛЬСКИМ ТЕГОМ" IS A PARENT, NOT A REPLACEMENT. Each service keeps the
 * tree its own document produced, tags and all, under a group of its own, so a reader who knows
 * one service still finds it arranged the way that service arranges it.
 *
 * A SERVICE WITH NOTHING IN IT KEEPS ITS GROUP, which is where this differs from `buildNavigation`
 * in `core`, and deliberately. There an empty group is a declared tag nobody used; here it is a
 * service that is really in the federation and really has no operations, and a reader who cannot
 * see it in the navigation has been told it is not there.
 *
 * A DEDUPLICATED SCHEMA APPEARS UNDER EVERY SERVICE THAT USES IT. Both entries are true and both
 * resolve; the second one's id is escaped, since two entries cannot share one id.
 */
function buildNavigation(ordered: readonly FederationService[], plan: BuildPlan): IRNavNode[] {
  const claims: NameClaim<NavSubject>[] = [];

  for (const service of ordered) {
    claims.push({
      name: `group-service-${service.id}`,
      serviceIds: [service.id],
      subject: { kind: 'service-group', serviceId: service.id },
    });

    for (const entry of flattenNavigation(service.document.navigation)) {
      claims.push({
        name: preferredNavId(entry, service.id, plan.maps.get(service.id)),
        serviceIds: [service.id],
        subject: { kind: 'entry', serviceId: service.id, entry },
      });
    }
  }

  const assigned = new Map<IRNavNode, string>();
  const groupIds = new Map<string, string>();

  for (const resolved of allocateUnique(claims, identifierRules<NavSubject>('navigation entry'))) {
    if (resolved.subject.kind === 'service-group') {
      groupIds.set(resolved.subject.serviceId, resolved.name);
      continue;
    }

    assigned.set(resolved.subject.entry, resolved.name);
    if (resolved.escaped) {
      plan.renames.push({
        kind: 'navigation',
        serviceId: resolved.subject.serviceId,
        from: resolved.subject.entry.id,
        to: resolved.name,
        reason: 'uniqueness',
        contestedBy: [],
      });
    }
  }

  return ordered.map((service) => {
    const maps = plan.maps.get(service.id);
    return {
      id: groupIds.get(service.id) ?? `group-service-${service.id}`,
      label: service.document.info.title,
      kind: 'group' as const,
      children: service.document.navigation.map((entry) => rewriteNavEntry(entry, assigned, maps)),
    };
  });
}

/** Rewrites one navigation entry and everything under it onto the merged ids. */
function rewriteNavEntry(
  entry: IRNavNode,
  assigned: ReadonlyMap<IRNavNode, string>,
  maps: MutableMaps | undefined,
): IRNavNode {
  const draft: { -readonly [Key in keyof IRNavNode]: IRNavNode[Key] } = {
    id: assigned.get(entry) ?? entry.id,
    label: entry.label,
    kind: entry.kind,
    children: entry.children.map((child) => rewriteNavEntry(child, assigned, maps)),
  };

  if (entry.nodeId !== undefined) draft.nodeId = maps?.nodeIds.get(entry.nodeId) ?? entry.nodeId;
  if (entry.schemaId !== undefined) {
    draft.schemaId = maps?.schemaIds.get(entry.schemaId) ?? entry.schemaId;
  }
  if (entry.deprecated !== undefined) draft.deprecated = entry.deprecated;

  return draft;
}

/** The id a navigation entry would have if nothing else wanted it. */
function preferredNavId(
  entry: IRNavNode,
  serviceId: string,
  maps: MutableMaps | undefined,
): string {
  if (entry.nodeId !== undefined) {
    return `nav-${maps?.nodeIds.get(entry.nodeId) ?? entry.nodeId}`;
  }
  if (entry.schemaId !== undefined) {
    return `nav-schema-${maps?.schemaIds.get(entry.schemaId) ?? entry.schemaId}`;
  }
  return namespaceIdentifier(entry.id, serviceId);
}

/** Every entry of a navigation tree, parents before children. */
function flattenNavigation(tree: readonly IRNavNode[]): IRNavNode[] {
  const flat: IRNavNode[] = [];

  const visit = (entry: IRNavNode): void => {
    flat.push(entry);
    for (const child of entry.children) visit(child);
  };
  for (const entry of tree) visit(entry);

  return flat;
}

/**
 * Refuses a merged document whose references no longer resolve.
 *
 * WHAT IT COMPARES AGAINST IS THE SOURCES, NOT PERFECTION. Real documents arrive with a security
 * requirement naming a scheme nobody declared, and refusing to federate one would be this tool
 * inventing a rule the specification does not have. Rewriting leaves an unmapped target exactly as
 * it was, so a reference that was already dangling still reads as the same string, and the merge
 * is answerable for the difference between the two sets rather than for the state of the inputs.
 *
 * EXPORTED SO THE REFUSAL ITSELF CAN BE SEEN FIRING. While the rewrite is complete, no input to
 * `mergeDocuments` reaches this throw, which is what both of them are for. So the suite that
 * proves the refusal works hands this check a document the rewrite never built, carrying exactly
 * the stale reference a forgotten field would leave behind.
 *
 * @param ordered - The source services
 * @param document - The document the merge built
 * @throws {FederationError} When a reference that resolved in a source no longer resolves
 */
export function refuseBrokenReferences(
  ordered: readonly FederationService[],
  document: IRDocument,
): void {
  const before = new Set<string>();
  for (const service of ordered) {
    for (const reference of unresolvedReferences(service.document)) {
      before.add(`${reference.kind} ${reference.target}`);
    }
  }

  const introduced = unresolvedReferences(document).filter(
    (reference) => !before.has(`${reference.kind} ${reference.target}`),
  );
  const mismatched = mismatchedKeys(document);

  if (introduced.length === 0 && mismatched.length === 0) return;

  throw new FederationError(
    'the merge produced a document whose own references do not resolve: ' +
      [describeReferences(introduced), ...mismatched].filter((part) => part !== '').join('; '),
    ErrorCode.FED_MERGE_INCOMPLETE,
    undefined,
    { introduced: introduced.length, mismatched: mismatched.length },
  );
}

/** The first few unresolved references, written out, so a message names something specific. */
function describeReferences(references: readonly UnresolvedReference[]): string {
  return references
    .slice(0, 5)
    .map((reference) => `${reference.at} refers to the ${reference.kind} ${reference.target}`)
    .join('; ');
}

/** The id a schema class prefers: the lowest of the ids its members were registered under. */
function preferredSchemaId(schemaClass: SchemaClass): string {
  return schemaClass.members
    .map((member) => member.schemaId)
    .reduce((lowest, candidate) => (compareText(candidate, lowest) < 0 ? candidate : lowest));
}

/**
 * The rules of the node id space: folded keys, `<serviceId>_` namespacing, numeric escapes.
 *
 * THE PREFIX IS SEPARABLE BECAUSE OF A MEASUREMENT AND A REFUSAL, both recorded in SPEC 15. A
 * derived node id never contains an underscore, 0 of 1228 across the corpus, because `pathSlug`
 * replaces everything that is not a letter or a digit; and a service id is held to the same
 * alphabet at validation. So the first underscore separates the two halves and a prefixed id can
 * never equal an unprefixed one.
 */
function identifierRules<T>(subjectLabel: string): NameSpaceRules<T> {
  return {
    subjectLabel,
    keyOf: (name) => identifierKey(name),
    namespace: (name, serviceId) => namespaceIdentifier(name, serviceId),
    escape: escapeIdentifier,
  };
}

/**
 * The rules of the two spaces SPEC 15 namespaces by construction: schemas and security schemes.
 *
 * WHY NOT `<serviceId>_` HERE, AND IT IS MEASURED RATHER THAN PREFERRED. 1504 of 2378 corpus
 * schema ids contain an underscore, which is the whole of `stripe.yaml`, so a service called
 * `account` merged beside Stripe would produce `account_annual_revenue` for its own
 * `annual_revenue` and take the id of a real Stripe schema. `federatedSchemaId` puts the id in a
 * third space that no document can spell, and the proof is in SPEC 5.1.1 and SPEC 15.
 *
 * THE ESCAPE BELOW IS THEREFORE UNREACHABLE HERE, AND STAYS. SPEC 15 says what it is for once the
 * construction guarantees a free id: a guard against an implementation error, not a mechanism the
 * merge relies on. A counter that fires on every Stripe schema would not be a fallback.
 */
function federatedRules<T>(subjectLabel: string): NameSpaceRules<T> {
  return {
    subjectLabel,
    keyOf: (name) => identifierKey(name),
    namespace: (name, serviceId) => federatedSchemaId(serviceId, name),
    escape: escapeIdentifier,
  };
}

/**
 * The rules of the address space.
 *
 * ADDRESSES ARE KEYED EXACTLY AND IDENTIFIERS ARE KEYED BY THE CASE FOLD, and the difference is
 * not an oversight. `/Orders` and `/orders` are two endpoints of one API and an HTTP server tells
 * them apart, so treating them as one name would refuse or rename a document that is correct. An
 * id becomes a file name, where the same two are one file.
 */
const ADDRESS_RULES: NameSpaceRules<AddressSubject> = {
  subjectLabel: 'address',
  keyOf: (name, subject) =>
    subject.method === undefined ? `channel ${name}` : `${subject.method} ${name}`,
  namespace: (name, serviceId, subject) =>
    applyPrefix(servicePrefix(serviceId), name, subject.style),
  escape: (name, attempt) => `${name}-${String(attempt)}`,
};

/**
 * Records one rename, when the name actually moved.
 *
 * @param renames - The report's list, appended to
 * @param kind - What sort of name moved
 * @param serviceId - Service the name belonged to
 * @param from - The name as the service's own document wrote it
 * @param resolved - What the allocator decided
 * @param ruleReason - The reason to record when no conflict and no escape moved it
 */
function appendRename<T>(
  renames: MergeRename[],
  kind: MergeRenameKind,
  serviceId: string,
  from: string,
  resolved: ResolvedName<T>,
  ruleReason: MergeRenameReason,
): void {
  if (resolved.name === from) return;

  const conflictReason: MergeRenameReason =
    kind === 'path' || kind === 'channel-address' ? 'address-conflict' : 'name-conflict';

  const reason: MergeRenameReason =
    resolved.namespacedBy !== undefined
      ? conflictReason
      : resolved.escaped
        ? 'uniqueness'
        : ruleReason;

  renames.push({
    kind,
    serviceId,
    from,
    to: resolved.name,
    reason,
    contestedBy: resolved.contestedBy,
  });
}
