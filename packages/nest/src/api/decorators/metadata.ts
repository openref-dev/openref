/**
 * The keys this package's own decorators write under, and the two ways of writing them.
 *
 * TWO DESTINATIONS, AND WHICH ONE A DECORATOR USES IS NOT A STYLE CHOICE. A fact about the
 * running application goes to a metadata key that a collector reads, arrives in the IR through
 * `IRNodeRuntime`, and carries confidence and a collector name per SPEC 6.1. A fact about the
 * document goes into the specification itself as an `x-` extension, travels in `openapi.json`
 * to whatever else reads it, and reaches the IR through the normalizer's `readExtensions`.
 *
 * - `@ApiScopes`, `@ApiErrors` and `@ApiStream` describe the endpoint's behaviour. Runtime keys.
 * - `@ApiAudience`, `@ApiSample` and `@ApiExample` describe the documentation. Extensions.
 *
 * The split is visible in what a reader gets: an audience marking is in the specification an SDK
 * generator downloads, while a scope list is a runtime fact shown with its provenance beside it.
 *
 * NO IMPORT OF `@nestjs/common`, and the decorators are the obvious place that rule would have
 * been broken. `SetMetadata` is four lines of `Reflect.defineMetadata` with one branch, and
 * importing it would make `@nestjs/common` a value dependency of every consumer of this package's
 * entry point, which `shared/types/nest-surface.ts` allows exactly once and for something else.
 */

import { metadataReflect, SWAGGER_EXTENSION_METADATA } from '../../shared/types/nest-surface';

/**
 * Keys the collectors of SPEC 6.2 read back.
 *
 * NAMESPACED, because these sit on the same handler as every other decorator's metadata and a
 * key called `scopes` is a collision waiting for the first application that has its own.
 */
export const OPENREF_METADATA = {
  /** `@ApiScopes`, a list of strings, read as `declared`. */
  scopes: 'openref/scopes',
  /** `@ApiErrors`, the error classes as given. T021 turns them into contracts. */
  errors: 'openref/errors',
  /** `@ApiStream`, the whole option object. */
  stream: 'openref/stream',
} as const;

/**
 * The key the compile time AST plugin writes the item type of a stream under.
 *
 * LEVEL THREE OF SPEC 13.6, AND IT IS A KEY RATHER THAN AN INFERENCE PERFORMED HERE. Reflection
 * cannot produce `OrderDto` out of `Observable<MessageEvent<OrderDto>>`, at any confidence: the
 * type is not in the compiled code. A plugin runs while it still is, and writes what it saw here.
 * Whatever is found under this key is read as `inferred`, because the plugin sees the name written
 * in the source and does not check what stands behind it.
 *
 * The plugin itself is not part of M1. The key is declared now because the collector reads it now,
 * and a level of the priority that no code can reach is a level that is not really there.
 */
export const OPENREF_STREAM_ITEM_METADATA = 'openref/stream-item';

/** Extension keys this package writes into the specification. */
export const OPENREF_EXTENSIONS = {
  /** Who a node is for, per SPEC 13.4. */
  audience: 'x-openref-audience',
  /** Request and response pairs a person wrote, per `@ApiExample`. */
  examples: 'x-openref-examples',
  /**
   * Code samples, under the name the ecosystem already reads.
   *
   * `x-codeSamples` RATHER THAN `x-openref-samples`, which is the one place this package uses
   * somebody else's spelling on purpose. It is what Redoc and several generators look for, and a
   * sample nobody but this renderer can find is a sample written twice.
   */
  samples: 'x-codeSamples',
} as const;

/** A decorator usable on a class and on a method alike, which is what Nest's own are. */
export type OpenRefDecorator = (
  target: object,
  propertyKey?: string | symbol,
  descriptor?: PropertyDescriptor,
) => void;

/**
 * The target metadata is written on: the handler function, or the class.
 *
 * THE SAME BRANCH `SetMetadata` MAKES, and for the same reason. Nest reads a method's metadata off
 * the function itself, because that is what a route table holds a reference to, and a class's off
 * the constructor.
 *
 * @param target - The class, or its prototype when a method is being decorated
 * @param descriptor - The property descriptor, present only for a method
 * @returns Where to write
 */
function metadataTarget(target: object, descriptor: PropertyDescriptor | undefined): object {
  const handler: unknown = descriptor?.value;

  return typeof handler === 'function' ? handler : target;
}

/**
 * Writes one OPENREF metadata key.
 *
 * @param key - One of {@link OPENREF_METADATA}
 * @param value - What to put under it
 * @returns The decorator
 */
export function setOpenRefMetadata(key: string, value: unknown): OpenRefDecorator {
  return (target, _propertyKey, descriptor): void => {
    metadataReflect().defineMetadata(key, value, metadataTarget(target, descriptor));
  };
}

/**
 * What an extension is set to: a value, or a function of whatever is already under the key.
 *
 * The second form is what lets `@ApiSample` accumulate rather than replace, since an endpoint
 * documented in two languages has the decorator applied twice.
 */
export type ExtensionValue = string | ((existing: unknown) => unknown);

/**
 * Adds one `x-` extension to the operation, without disturbing the others.
 *
 * READ, MERGE, WRITE, because the object under this key belongs to every extension the operation
 * has, including ones the host wrote with `@nestjs/swagger`'s own `ApiExtension`. Replacing it
 * would delete theirs, and the failure would be invisible: the document would simply not carry an
 * extension somebody had declared.
 *
 * @param key - Extension name, beginning with `x-`
 * @param value - Extension value, or a function that merges with what is already there
 * @returns The decorator
 */
export function setExtension(key: string, value: ExtensionValue): OpenRefDecorator {
  return (target, _propertyKey, descriptor): void => {
    const reflect = metadataReflect();
    const on = metadataTarget(target, descriptor);
    const current = reflect.getMetadata(SWAGGER_EXTENSION_METADATA, on);
    const extensions: Record<string, unknown> =
      typeof current === 'object' && current !== null ? { ...current } : {};

    extensions[key] = typeof value === 'function' ? value(extensions[key]) : value;

    reflect.defineMetadata(SWAGGER_EXTENSION_METADATA, extensions, on);
  };
}
