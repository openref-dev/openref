import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import {
  ApiAudience,
  ApiErrors,
  ApiExample,
  ApiSample,
  ApiScopes,
  ApiStream,
} from '../../src/api/decorators/api-decorators';
import { OPENREF_EXTENSIONS, OPENREF_METADATA } from '../../src/api/decorators/metadata';
import { SWAGGER_EXTENSION_METADATA } from '../../src/shared/types/nest-surface';

/**
 * The six decorators of SPEC 13.4, checked for where they write rather than for what they return.
 *
 * WHERE A DECORATOR WRITES IS ITS WHOLE CONTRACT, because nothing else in the system reads it: a
 * collector reads a key, and `@nestjs/swagger` reads the extension object. A decorator that stored
 * its argument somewhere else would be a decorator a host applies and nothing acts on, which is
 * the class of defect that stays green in every test that only calls the function.
 *
 * `Reflect.getMetadata` RATHER THAN NEST'S `Reflector`, deliberately: what is asserted here is the
 * write, and reading it back through the same abstraction the collectors use would let a wrong key
 * on both sides agree with itself. `test/unit/nest-value-surface.spec.ts` is where the framework's
 * own keys are pinned against the real decorators.
 */

/** Reads a key off a method, the way a collector's reflector does. */
function metadataOf(target: object, method: string, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(target, method);
  const handler = descriptor?.value as object;

  return Reflect.getMetadata(key, handler);
}

/** Applies a decorator to a method, which is what TypeScript does at a decoration site. */
function apply(
  decorator: (target: object, key?: string | symbol, descriptor?: PropertyDescriptor) => void,
  prototype: object,
  method: string,
): void {
  const descriptor = Object.getOwnPropertyDescriptor(prototype, method);
  if (descriptor === undefined) throw new Error(`no method ${method} to decorate`);

  decorator(prototype, method, descriptor);
}

describe('the decorators that write runtime metadata', () => {
  it('should put the scopes where the declarations collector reads them', () => {
    // Given
    class Orders {
      list(): undefined {
        return undefined;
      }
    }

    // When
    apply(ApiScopes('orders:read', 'orders:list'), Orders.prototype, 'list');

    // Then
    expect(metadataOf(Orders.prototype, 'list', OPENREF_METADATA.scopes)).toEqual([
      'orders:read',
      'orders:list',
    ]);
  });

  it('should write on the class when applied to one', () => {
    // Given, a controller wide declaration, which a method may then override
    class Orders {
      list(): undefined {
        return undefined;
      }
    }

    // When
    ApiScopes('orders:read')(Orders);

    // Then
    expect(Reflect.getMetadata(OPENREF_METADATA.scopes, Orders)).toEqual(['orders:read']);
  });

  it('should store the error classes as given, which T021 turns into contracts', () => {
    // Given
    class NotFoundError extends Error {}
    class DeniedError extends Error {}
    class Orders {
      read(): undefined {
        return undefined;
      }
    }

    // When
    apply(ApiErrors(NotFoundError, DeniedError), Orders.prototype, 'read');

    // Then
    expect(metadataOf(Orders.prototype, 'read', OPENREF_METADATA.errors)).toEqual([
      NotFoundError,
      DeniedError,
    ]);
  });

  it('should keep every field of a stream declaration', () => {
    // Given
    class ProgressDto {
      percent = 0;
    }
    class Jobs {
      watch(): undefined {
        return undefined;
      }
    }

    // When
    apply(
      ApiStream({ itemType: ProgressDto, kind: 'sse', terminator: '[DONE]' }),
      Jobs.prototype,
      'watch',
    );

    // Then
    expect(metadataOf(Jobs.prototype, 'watch', OPENREF_METADATA.stream)).toEqual({
      itemType: ProgressDto,
      kind: 'sse',
      terminator: '[DONE]',
    });
  });
});

describe('the decorators that write specification extensions', () => {
  it('should mark the audience in the object @nestjs/swagger builds from', () => {
    // Given
    class Orders {
      purge(): undefined {
        return undefined;
      }
    }

    // When
    apply(ApiAudience('internal'), Orders.prototype, 'purge');

    // Then
    expect(metadataOf(Orders.prototype, 'purge', SWAGGER_EXTENSION_METADATA)).toEqual({
      [OPENREF_EXTENSIONS.audience]: 'internal',
    });
  });

  it('should accumulate samples rather than replace them', () => {
    // Given an endpoint documented in two languages, which is two decorators
    class Orders {
      list(): undefined {
        return undefined;
      }
    }

    // When
    apply(ApiSample({ lang: 'bash', source: 'curl ...' }), Orders.prototype, 'list');
    apply(
      ApiSample({ lang: 'typescript', label: 'SDK', source: 'client.list()' }),
      Orders.prototype,
      'list',
    );

    // Then
    const extensions = metadataOf(Orders.prototype, 'list', SWAGGER_EXTENSION_METADATA);
    expect(extensions).toEqual({
      [OPENREF_EXTENSIONS.samples]: [
        { lang: 'bash', source: 'curl ...' },
        { lang: 'typescript', source: 'client.list()', label: 'SDK' },
      ],
    });
  });

  it('should leave an extension somebody else wrote alone', () => {
    // Given, the object under this key belongs to every extension the operation has, including
    // ones written with @nestjs/swagger's own ApiExtension. Replacing it would delete theirs, and
    // the loss would be invisible in the served document.
    class Orders {
      list(): undefined {
        return undefined;
      }
    }
    const descriptor = Object.getOwnPropertyDescriptor(Orders.prototype, 'list');
    Reflect.defineMetadata(
      SWAGGER_EXTENSION_METADATA,
      { 'x-internal-owner': 'payments' },
      descriptor?.value as object,
    );

    // When
    apply(ApiAudience('partner'), Orders.prototype, 'list');
    apply(ApiExample({ name: 'Success', response: { ok: true } }), Orders.prototype, 'list');

    // Then
    expect(metadataOf(Orders.prototype, 'list', SWAGGER_EXTENSION_METADATA)).toEqual({
      'x-internal-owner': 'payments',
      [OPENREF_EXTENSIONS.audience]: 'partner',
      [OPENREF_EXTENSIONS.examples]: [{ name: 'Success', response: { ok: true } }],
    });
  });

  it('should use the extension name the ecosystem already reads for samples', () => {
    // Given, `x-codeSamples` is what Redoc and several generators look for. A sample only this
    // renderer can find is a sample written twice.
    expect(OPENREF_EXTENSIONS.samples).toBe('x-codeSamples');

    // And the two that are ours carry the prefix the naming rules reserve
    expect(OPENREF_EXTENSIONS.audience).toBe('x-openref-audience');
    expect(OPENREF_EXTENSIONS.examples).toBe('x-openref-examples');
  });
});
