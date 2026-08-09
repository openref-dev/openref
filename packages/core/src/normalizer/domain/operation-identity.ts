/**
 * Operation identity, per SPEC 5.4.
 *
 * An id is a permalink, a search key, a diff key and a federation key. It has to be derived from
 * the document rather than from iteration order, stable across runs, and unique.
 */

/** Methods OpenAPI names explicitly, including `query` from 3.2. */
export const STANDARD_HTTP_METHODS = [
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
  'query',
] as const;

/** An `operationId` of the shape `@nestjs/swagger` generates, for example `OrdersController_findAll`. */
const GENERATED_OPERATION_ID = /^[A-Za-z][A-Za-z0-9]*_[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Reports whether a method name is one the specification enumerates.
 *
 * @param method - Lowercase method name
 * @returns True when the method is in {@link STANDARD_HTTP_METHODS}
 */
export function isStandardHttpMethod(method: string): boolean {
  return STANDARD_HTTP_METHODS.some((candidate) => candidate === method);
}

/**
 * Turns a path into a slug.
 *
 * Template braces are dropped rather than encoded, so `/orders/{id}/items` becomes
 * `orders-id-items`. Two paths that differ only in the name of a template variable therefore
 * produce different slugs, which is what makes the slug usable as an id.
 *
 * @param path - Path exactly as the document wrote it
 * @returns A lowercase slug, `root` for the root path
 *
 * @example
 * pathSlug('/orders/{orderId}/items'); // 'orders-orderid-items'
 */
export function pathSlug(path: string): string {
  const slug = path
    .toLowerCase()
    .replace(/[{}]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug === '' ? 'root' : slug;
}

/**
 * Builds the node id of an operation.
 *
 * @param method - Method name, any case
 * @param path - Path exactly as the document wrote it
 * @returns An id of the form `<method>-<path-slug>`
 *
 * @example
 * operationNodeId('GET', '/orders/{id}'); // 'get-orders-id'
 */
export function operationNodeId(method: string, path: string): string {
  return `${method.toLowerCase()}-${pathSlug(path)}`;
}

/**
 * Reports whether an `operationId` was generated from a controller and a method name.
 *
 * Only that shape is rewritten. An id an author wrote by hand is a deliberate public name and
 * is left exactly as it is.
 *
 * @param operationId - Id from the document
 * @returns True when the id looks like `Controller_method`
 */
export function isGeneratedOperationId(operationId: string): boolean {
  return GENERATED_OPERATION_ID.test(operationId);
}

/** One operation, as far as identity is concerned. */
export interface OperationIdentityInput {
  readonly method: string;
  readonly path: string;
  /** `operationId` exactly as the document wrote it, when it has one. */
  readonly rawOperationId?: string;
}

/** The identity assigned to one operation. */
export interface OperationIdentity {
  /** Node id, unique within the document. */
  readonly id: string;
  /** Public operation id, rewritten when the document's own was generated. */
  readonly operationId: string;
  /** The document's own id, kept whether it was rewritten or not. */
  readonly rawOperationId?: string;
}

function disambiguate(candidate: string, taken: Set<string>): string {
  if (!taken.has(candidate)) return candidate;

  let suffix = 2;
  while (taken.has(`${candidate}-${String(suffix)}`)) suffix += 1;
  return `${candidate}-${String(suffix)}`;
}

/**
 * Assigns an identity to every operation, in document order.
 *
 * An `operationId` of the form `Controller_method` is replaced by `<method>-<path-slug>`, and the
 * original is kept in `rawOperationId`. A collision, which a real document does produce, is
 * resolved by a numeric suffix in document order, so the result is stable across runs.
 *
 * @param operations - Operations in document order
 * @returns One identity per input, in the same order
 *
 * @example
 * assignOperationIdentities([{ method: 'get', path: '/orders', rawOperationId: 'C_findAll' }]);
 * // [{ id: 'get-orders', operationId: 'get-orders', rawOperationId: 'C_findAll' }]
 */
export function assignOperationIdentities(
  operations: readonly OperationIdentityInput[],
): OperationIdentity[] {
  const takenIds = new Set<string>();
  const takenOperationIds = new Set<string>();

  return operations.map((operation) => {
    const derived = operationNodeId(operation.method, operation.path);
    const id = disambiguate(derived, takenIds);
    takenIds.add(id);

    const raw = operation.rawOperationId;
    const keepsOwn = raw !== undefined && raw !== '' && !isGeneratedOperationId(raw);
    const operationId = disambiguate(keepsOwn ? raw : derived, takenOperationIds);
    takenOperationIds.add(operationId);

    const identity: { -readonly [Key in keyof OperationIdentity]: OperationIdentity[Key] } = {
      id,
      operationId,
    };
    if (raw !== undefined && raw !== '') identity.rawOperationId = raw;

    return identity;
  });
}
