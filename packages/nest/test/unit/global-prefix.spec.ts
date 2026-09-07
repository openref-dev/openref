import { describe, expect, it } from 'vitest';
import { readGlobalPrefix } from '../../src/runtime/domain/global-prefix';
import type {
  DiscoveryServiceLike,
  InstanceWrapperLike,
} from '../../src/shared/types/nest-surface';

/**
 * Reading the global prefix off the container, which is what makes pairing rule two able to pair.
 *
 * WHY IT IS WORTH A SUITE OF ITS OWN. The value is not written into any document, so nothing
 * downstream would ever show it to be wrong; what it changes is which node a runtime fact lands
 * on, and that failure is silent by construction. The reading is therefore pinned here and the
 * pairing it feeds is pinned in `route-pairing.spec.ts`, so a break says which of the two it is.
 *
 * THE REAL FRAMEWORK IS ASSERTED SEPARATELY, in `nest-value-surface.spec.ts`, which boots an
 * application, sets a prefix and asks the installed NestJS whether `ApplicationConfig` is still in
 * the enumeration this walks. These cases are about what the walk does with what it finds.
 */

function discoveryOver(providers: readonly InstanceWrapperLike[]): DiscoveryServiceLike {
  return { getControllers: () => [], getProviders: () => providers };
}

/** The framework's own class, by the name and the accessor the walk matches on. */
class ApplicationConfig {
  constructor(private readonly prefix: string) {}

  getGlobalPrefix(): string {
    return this.prefix;
  }
}

describe('readGlobalPrefix', () => {
  it('should read the prefix a host passed to setGlobalPrefix', () => {
    // Given
    const discovery = discoveryOver([{ instance: new ApplicationConfig('api/v1') }]);

    // When
    const reading = readGlobalPrefix(discovery);

    // Then, in the spelling a document path is written in
    expect(reading.prefix).toBe('/api/v1');
  });

  it('should read the three spellings NestJS accepts as one prefix', () => {
    // Given, `setGlobalPrefix` takes any of these and the document carries one form
    const spellings = ['api/v1', '/api/v1', '/api/v1/'];

    // When
    const read = spellings.map(
      (spelling) =>
        readGlobalPrefix(discoveryOver([{ instance: new ApplicationConfig(spelling) }])).prefix,
    );

    // Then
    expect(read).toEqual(['/api/v1', '/api/v1', '/api/v1']);
  });

  it('should answer the empty string for an application that sets no prefix', () => {
    // Given
    const discovery = discoveryOver([{ instance: new ApplicationConfig('') }]);

    // When
    const reading = readGlobalPrefix(discovery);

    // Then, which is a fact about the application and not a failure to read one
    expect(reading.prefix).toBe('');
  });

  it('should answer undefined when the container holds no application configuration', () => {
    // Given a container that never held one, which is every hand built double in this suite
    const discovery = discoveryOver([{ instance: { canActivate: (): boolean => true } }]);

    // When
    const reading = readGlobalPrefix(discovery);

    // Then, and this is a different answer from the empty string: the pass reports it
    expect(reading.prefix).toBeUndefined();
  });

  it('should refuse a provider that borrows the name without the accessor', () => {
    // Given a host class of the same name, which the name check alone would have called
    class ApplicationConfig {
      readonly settings = { prefix: 'api/v1' };
    }

    // When
    const reading = readGlobalPrefix(discoveryOver([{ instance: new ApplicationConfig() }]));

    // Then
    expect(reading.prefix).toBeUndefined();
  });

  it('should refuse a plain object, which has no class to be recognised by', () => {
    // Given, the `guardName` rule: `{ getGlobalPrefix: () => 'api' }` is not the framework's
    const discovery = discoveryOver([{ instance: { getGlobalPrefix: (): string => 'api' } }]);

    // When
    const reading = readGlobalPrefix(discovery);

    // Then
    expect(reading.prefix).toBeUndefined();
  });
});
