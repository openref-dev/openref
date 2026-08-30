import { describe, expect, expectTypeOf, it } from 'vitest';
import { BridgeService } from '../../src/index';
import { assertBridgeOptions } from '../../src/bridge/domain/bridge-options';
import type {
  IBridgeSource,
  OpenRefDocumentOptions,
  OpenRefFederationOptions,
  OpenRefSetupOptions,
  OpenRefVisibility,
} from '../../src/index';

/**
 * The type level half of SPEC 14.8: under public visibility a bridge cannot be written at all.
 *
 * A COMPILE ERROR IS THE POINT, so the assertions are `@ts-expect-error` rather than a runtime
 * check of a value. `@ts-expect-error` fails the build when the line it guards STOPS being an
 * error, which is the direction that matters: the day the union is loosened, this file stops
 * compiling and `pnpm lint` says so. This is the shape `T013` used for the prefilled credential of
 * SPEC 14.4, and the root tsconfig typechecks the test tree, so it runs in `pnpm lint` too.
 *
 * THE DIRECTIVE SITS ON THE DECLARATION AND NOT ON THE `bridge` LINE, which is a detail worth
 * writing down because the first form of this file put it on the property and the directive read
 * as unused. A literal checked against a union is reported at the literal, since what failed is
 * the choice of arm rather than one member of a known shape.
 */

/** A source that exists to be written into an options literal, never to be subscribed to. */
const source: IBridgeSource = { subscribe: () => ({ close: (): void => undefined }) };

describe('the public visibility bridge restriction', () => {
  it('should refuse a bridge under public visibility, at compile time', () => {
    // Given, each of these is a mount a deployment on the open internet could otherwise write
    const attempts = (): void => {
      // @ts-expect-error a broker bridge is forbidden when the visibility is public
      const named: OpenRefSetupOptions = {
        document: {},
        visibility: 'public',
        bridge: { enabled: true, channels: ['orders.created'], source },
      };

      // @ts-expect-error an absent visibility is public by default, so the ban holds there too
      const absent: OpenRefSetupOptions = {
        document: {},
        bridge: { enabled: true, channels: ['orders.created'], source },
      };

      // @ts-expect-error the ban is on the shape, so an empty bridge is refused as well
      const empty: OpenRefSetupOptions = { document: {}, visibility: 'public', bridge: {} };

      void named;
      void absent;
      void empty;
    };

    // When
    void attempts;

    // Then, the assertion is that this file compiles, which `pnpm lint` proves
    expectTypeOf<OpenRefSetupOptions>().toBeObject();
  });

  it('should allow a bridge under a closed visibility, which is what makes the refusals real', () => {
    // Given the control: the same literal with the one member changed
    const options: OpenRefSetupOptions = {
      document: {},
      visibility: 'internal',
      bridge: { enabled: true, channels: ['orders.created'], source },
    };

    // When
    const bridge = new BridgeService('the control mount', options.bridge);

    // Then
    expect(bridge.enabled).toBe(true);
  });

  it('should hold the same ban on every entry of documents, handed and events alike', () => {
    // Given
    const attempts = (): void => {
      const entries: readonly OpenRefDocumentOptions[] = [
        {
          id: 'admin',
          route: '/docs/admin',
          document: {},
          visibility: 'internal',
          bridge: { enabled: true, channels: ['orders.created'], source },
        },
        {
          id: 'events',
          route: '/docs/events',
          kind: 'events',
          visibility: 'partner',
          bridge: { enabled: true, channels: ['orders.created'], source },
        },
        // @ts-expect-error a handed entry with no visibility is public and gets no bridge
        {
          id: 'public',
          route: '/docs',
          document: {},
          bridge: { enabled: true, channels: ['orders.created'], source },
        },
        // @ts-expect-error and an events entry is gated by exactly the same union
        {
          id: 'open-events',
          route: '/docs/open-events',
          kind: 'events',
          bridge: { enabled: true, channels: ['orders.created'], source },
        },
      ];

      void entries;
    };

    // When
    void attempts;

    // Then
    expectTypeOf<OpenRefDocumentOptions>().toBeObject();
  });

  it('should hold the ban on the federated mount, which is a mount like any other', () => {
    // Given
    const attempts = (): void => {
      const closed: OpenRefFederationOptions = {
        route: '/docs',
        id: 'estate',
        remotes: [{ id: 'billing', url: 'https://billing.example.com/openapi.json' }],
        visibility: 'internal',
        bridge: { enabled: true, channels: ['orders.created'], source },
      };

      // @ts-expect-error and refuses one on a public federation
      const open: OpenRefFederationOptions = {
        route: '/docs',
        id: 'estate',
        remotes: [{ id: 'billing', url: 'https://billing.example.com/openapi.json' }],
        bridge: { enabled: true, channels: ['orders.created'], source },
      };

      void closed;
      void open;
    };

    // When
    void attempts;

    // Then
    expectTypeOf<OpenRefFederationOptions>().toBeObject();
  });

  it('should refuse a visibility that is a variable rather than a literal, erring towards refusal', () => {
    // Given, a host whose visibility comes out of a configuration value
    const attempts = (visibility: OpenRefVisibility): void => {
      // @ts-expect-error neither arm accepts a visibility the compiler cannot tell from public
      const options: OpenRefSetupOptions = {
        document: {},
        visibility,
        bridge: { enabled: true, channels: ['orders.created'], source },
      };

      void options;
    };

    // When
    void attempts;

    // Then, and the migration is one narrowing, which the control below is
    const narrow = (visibility: OpenRefVisibility): OpenRefSetupOptions =>
      visibility === 'public'
        ? { document: {}, visibility }
        : {
            document: {},
            visibility,
            bridge: { enabled: true, channels: ['orders.created'], source },
          };

    expect(narrow('public').bridge).toBeUndefined();
    expect(narrow('internal').bridge).toBeDefined();
  });

  it('should still refuse an unusable bridge at boot for a caller with no types', () => {
    // Given, the type gate is the contract; this is the runtime half, for JavaScript, and it is
    // the same rule the runner of SPEC 14.4 keeps beside its own type gate
    const options = { enabled: true } as unknown as { readonly enabled: boolean };

    // When, Then
    expect(() => {
      assertBridgeOptions('the mount', options);
    }).toThrow(/hands it no source/);
  });
});
