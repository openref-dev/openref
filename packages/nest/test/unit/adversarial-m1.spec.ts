import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { hashDocument, normalizeOpenApiDocument } from '@openref/core';
import type { IRDocument, IRNode } from '@openref/core';
import { runRuntimePass } from '../../src/runtime/application/services/runtime-pass.service';
import { CollectorRegistry } from '../../src/runtime/application/services/collector-registry.service';
import type {
  CollectorContext,
  IRuntimeCollector,
} from '../../src/runtime/application/ports/collector.port';
import { NEST_ROUTE_METADATA } from '../../src/shared/types/nest-surface';
import type {
  DiscoveryServiceLike,
  ModuleRefLike,
  ReflectorLike,
} from '../../src/shared/types/nest-surface';
import {
  resetRepositoryCache,
  resolveGitRef,
} from '../../src/runtime/infrastructure/adapters/repository.adapter';
import {
  sourceCollector,
  type SourceCollector,
} from '../../src/runtime/infrastructure/collectors/source.collector';
import { specification } from '../mocks/fixtures';

/** A context over the fixture's one node, for a collector that only reads the handler. */
function contextFor(): CollectorContext {
  const target = targetOf();

  return {
    ...target,
    reflector,
    moduleRef,
    globalGuards: [],
    globalPipes: [],
    fact: (value, confidence) => ({ value, confidence, collector: 'testCollector' }),
  };
}

/**
 * T025, the adversarial pass over M1: SPEC 6 and 7 attacked rather than exercised.
 *
 * These are not tests of features. Each one is an attack that was run first and turned into a case
 * afterwards, so the file reads as the list of things that were tried. Where an attack found
 * nothing, the case stays, because the next change to the collector layer is what it is for.
 */

class OrdersController {
  readOrder(): string {
    return 'an order';
  }
}

const prototype = OrdersController.prototype as unknown as Record<string, unknown>;

const metadata = new Map<unknown, Record<string, unknown>>([
  [OrdersController, { [NEST_ROUTE_METADATA.path]: 'orders' }],
  [prototype.readOrder, { [NEST_ROUTE_METADATA.method]: 0, [NEST_ROUTE_METADATA.path]: ':id' }],
]);

const reflector: ReflectorLike = {
  get: (key, target) => metadata.get(target)?.[String(key)] ?? undefined,
  getAllAndOverride: () => undefined,
};

const moduleRef: ModuleRefLike = { get: () => undefined };

const discovery: DiscoveryServiceLike = {
  getControllers: () => [{ metatype: OrdersController, instance: new OrdersController() }],
  getProviders: () => [],
};

function document(): IRDocument {
  return normalizeOpenApiDocument(specification());
}

/** The one target a registry case needs, built from the fixture's only node. */
function targetOf(): {
  node: IRNode;
  controller: typeof OrdersController;
  declaredOn: typeof OrdersController;
  handler: () => string;
  handlerName: string;
} {
  const node = [...document().nodes.values()][0];
  if (node === undefined) throw new Error('the fixture has no node');

  return {
    node,
    controller: OrdersController,
    declaredOn: OrdersController,
    handler: () => 'an order',
    handlerName: 'readOrder',
  };
}

function registryOf(
  collectors: readonly IRuntimeCollector[],
  globalGuards?: readonly string[],
): CollectorRegistry {
  return new CollectorRegistry(collectors, {
    reflector,
    moduleRef,
    ...(globalGuards === undefined ? {} : { globalGuards }),
  });
}

describe('T025 attack: a collector that mutates what it was given', () => {
  it('should not let a collector edit the node the rest of the pass reads', () => {
    // Given a collector that writes on the node in its context. The types say readonly and
    // nothing at runtime says anything, so this compiles in a third party package under a cast
    // and there is no reason to expect a stranger's collector not to try it.
    const vandal: IRuntimeCollector = {
      name: 'vandalCollector',
      collect: (context: CollectorContext) => {
        (context.node as { id: string }).id = 'somewhere-else';
        (context.node as { runtime?: unknown }).runtime = { guards: [] };

        return undefined;
      },
    };
    const target = targetOf();
    const before = target.node.id;

    // When
    registryOf([vandal]).collect(target);

    // Then the node the pass keys facts by, hashes and serves is unchanged
    expect(target.node.id).toBe(before);
    expect(target.node.runtime).toBeUndefined();
  });

  /**
   * The other thing the context hands over that the product reads afterwards.
   *
   * FOUND BY SWEEPING FOR F38's SHAPE AND NOT BY MEETING IT. The node was the instance; the
   * global guard list is the other one, and it is worse in a small way: it is a single array
   * shared by every context of every node, so one collector's edit is read by every collector
   * that runs after it, on every route the pass has not reached yet. `guardsCollector` draws the
   * `Guards, global` row straight from it, so the reference would name a guard nobody registered
   * on most of an application, and the type would still say `readonly string[]`.
   */
  it('should not let a collector edit the global guard list every other collector reads', () => {
    // Given a collector that writes to the list it was handed, and one that reports what it sees
    const seen: string[][] = [];
    const vandal: IRuntimeCollector = {
      name: 'vandalCollector',
      collect: (context: CollectorContext) => {
        try {
          (context.globalGuards as string[]).push('GuardNobodyRegistered');
        } catch {
          // A frozen array throws on push in an ES module, which the registry handles by
          // retiring the collector. What matters here is what the next one is given.
        }

        return undefined;
      },
    };
    const witness: IRuntimeCollector = {
      name: 'witnessCollector',
      collect: (context: CollectorContext) => {
        seen.push([...context.globalGuards]);

        return undefined;
      },
    };
    const registry = registryOf([vandal, witness], ['ReadonlyGuard']);

    // When two nodes go past, which is what makes the list's lifetime longer than one context
    registry.collect(targetOf());
    registry.collect(targetOf());

    // Then every collector after it saw the registration and nothing else
    expect(seen).toEqual([['ReadonlyGuard'], ['ReadonlyGuard']]);
  });

  it('should not let a collector edit the list the host still holds', () => {
    // Given a host that keeps its own array, which is how the pass hands it over
    const hostList = ['ReadonlyGuard'];
    const vandal: IRuntimeCollector = {
      name: 'vandalCollector',
      collect: (context: CollectorContext) => {
        try {
          (context.globalGuards as string[]).length = 0;
        } catch {
          // As above.
        }

        return undefined;
      },
    };

    // When
    registryOf([vandal], hostList).collect(targetOf());

    // Then the caller's array is the caller's
    expect(hostList).toEqual(['ReadonlyGuard']);
  });
});

describe('T025 attack: a collector reporting a finding about a node that is not there', () => {
  it('should not put a finding naming a node the document does not hold into the report', () => {
    // Given a collector returning drift for a node id nobody has. `IRDriftIssue.nodeId` is a free
    // string and a collector fills it in, so a stale id from a cache, a typo, or a remote's id in
    // a federated document all reach here.
    const ghost: IRuntimeCollector = {
      name: 'ghostCollector',
      collect: () => ({
        drift: [
          {
            rule: 'scope-drift',
            severity: 'warning',
            nodeId: 'a-node-that-does-not-exist',
            message: 'scopes differ',
            suggestion: 'list them',
            classification: { bucket: 'manual', reason: 'structural-ambiguity' },
            edit: 'narrowed-assertion',
            basis: { kind: 'unobserved' },
          },
        ],
      }),
    };

    // When
    const result = runRuntimePass(document(), {
      collectors: [ghost],
      discovery,
      reflector,
      moduleRef,
    });

    // Then every finding a reader can reach names a node the document holds
    const findings = [...result.document.nodes.values()].flatMap(
      (node) => node.runtime?.drift ?? [],
    );
    for (const finding of findings) {
      if (finding.nodeId === undefined) continue;
      expect(result.document.nodes.has(finding.nodeId)).toBe(true);
    }
  });
});

describe('T025 attack: a collector that never returns', () => {
  it('should say which collector was slow, so a boot that hangs names its cause', () => {
    // Given a collector that takes a long time rather than one that never returns, because a
    // synchronous hang cannot be interrupted from JavaScript and a case that hangs is a case that
    // hangs the suite. The question is whether anything reports it at all.
    const slow: IRuntimeCollector = {
      name: 'slowCollector',
      collect: () => {
        const until = performance.now() + 60;
        while (performance.now() < until) {
          /* burn */
        }

        return undefined;
      },
    };

    // When
    const registry = registryOf([slow]);
    registry.collect(targetOf());

    // Then
    expect(registry.meta().collectors).toContain('slowCollector');
  });
});

describe('T025 attack: an inferred fact wearing a declared mark', () => {
  it('should keep the confidence a collector stated, and never raise it', () => {
    // Given two collectors disagreeing about one field, the weaker one registered last. The merge
    // rewrites `collector` on every fact it takes; the attack is whether it ever rewrites
    // `confidence` in the same breath, which would be the one route by which a guess is promoted.
    const guessed: IRuntimeCollector = {
      name: 'astCollector',
      collect: (context) => ({ scopes: context.fact(['orders:guessed'], 'inferred') }),
    };
    const written: IRuntimeCollector = {
      name: 'scopesCollector',
      collect: (context) => ({ scopes: context.fact(['orders:read'], 'declared') }),
    };

    // When, in both orders, because a promotion that depends on order is still a promotion
    const first = registryOf([guessed, written]).collect(targetOf());
    const second = registryOf([written, guessed]).collect(targetOf());

    // Then
    expect(first?.scopes).toEqual({
      value: ['orders:read'],
      confidence: 'declared',
      collector: 'scopesCollector',
    });
    expect(second?.scopes).toEqual(first?.scopes);
  });

  it('should derive an error contract at derived even when the guard behind it is declared', () => {
    // Given a guard reported at `declared`, which no collector in this package does and a third
    // party one is free to. SPEC 6.4 fixes the runtime-derived group at `derived`, so a
    // derivation inheriting its input's confidence would be the promotion path.
    const declaredGuard: IRuntimeCollector = {
      name: 'someoneElsesCollector',
      collect: () => ({
        guards: [
          {
            name: 'AuthGuard',
            scope: 'route' as const,
            confidence: 'declared' as const,
            collector: 'someoneElsesCollector',
          },
        ],
        errors: { declared: [], runtimeDerived: [], global: [] },
      }),
    };

    // When
    const result = runRuntimePass(document(), {
      collectors: [declaredGuard],
      discovery,
      reflector,
      moduleRef,
    });

    // Then
    const derived = [...result.document.nodes.values()][0]?.runtime?.errors?.runtimeDerived ?? [];
    expect(derived.length).toBeGreaterThan(0);
    expect(derived.every((contract) => contract.confidence === 'derived')).toBe(true);
  });
});

describe('T025 attack: the same metadata key claimed by two libraries', () => {
  it('should report both facts rather than silently give one library the other one value', () => {
    // Given two collectors configured with one key, which is what happens when two libraries pick
    // the same constant name and a host wires both. Both read the same array and both believe it.
    const shared = 'PERMISSIONS_KEY';
    const table = new Map<unknown, Record<string, unknown>>([
      [prototype.readOrder, { [shared]: ['orders:read'] }],
    ]);
    const sharedReflector: ReflectorLike = {
      get: (key, target) => table.get(target)?.[String(key)] ?? undefined,
      getAllAndOverride: (key, targets) => {
        for (const target of targets) {
          const held = table.get(target)?.[String(key)];
          if (held !== undefined) return held;
        }

        return undefined;
      },
    };
    const asScopes: IRuntimeCollector = {
      name: 'scopesCollector',
      collect: (context) => {
        const held = context.reflector.getAllAndOverride(shared, [context.handler]);

        return Array.isArray(held)
          ? { scopes: context.fact(held as string[], 'derived') }
          : undefined;
      },
    };
    const asRoles: IRuntimeCollector = {
      name: 'rolesCollector',
      collect: (context) => {
        const held = context.reflector.getAllAndOverride(shared, [context.handler]);

        return Array.isArray(held)
          ? { roles: context.fact(held as string[], 'derived') }
          : undefined;
      },
    };

    // When
    const result = new CollectorRegistry([asScopes, asRoles], {
      reflector: sharedReflector,
      moduleRef,
    }).collect({ ...targetOf(), handler: prototype.readOrder as () => string });

    // Then both fields hold the same value, which is what a shared key means, and each names the
    // collector that produced it so a reader can see the two came from one place
    expect(result?.scopes?.value).toEqual(['orders:read']);
    expect(result?.roles?.value).toEqual(['orders:read']);
    expect(result?.scopes?.collector).toBe('scopesCollector');
    expect(result?.roles?.collector).toBe('rolesCollector');
  });
});

describe('T025 attack: a collector that returns an enormous amount', () => {
  it('should not spend the boot merging a list nobody can read', () => {
    // Given a collector reporting fifty thousand guards on one route
    const flood: IRuntimeCollector = {
      name: 'floodCollector',
      collect: () => ({
        guards: Array.from({ length: 50_000 }, (_unused, index) => ({
          name: `Guard${String(index)}`,
          scope: 'route' as const,
          confidence: 'derived' as const,
          collector: 'floodCollector',
        })),
      }),
    };

    // When
    const started = performance.now();
    const result = registryOf([flood]).collect(targetOf());
    const elapsed = performance.now() - started;

    // Then, recorded rather than asserted about: what this case exists to catch is the day the
    // merge becomes quadratic in the length of a list a collector chose
    expect(result?.guards).toHaveLength(50_000);
    expect(elapsed).toBeLessThan(2000);
  });
});

/** One enhancer of each family, named so the reading has something to tell apart. */
class ReadonlyGuard {
  canActivate(): boolean {
    return true;
  }
}
class LoggingInterceptor {
  intercept(): undefined {
    return undefined;
  }
}
class TrimPipe {
  transform(value: unknown): unknown {
    return value;
  }
}
class EverythingFilter {
  catch(): undefined {
    return undefined;
  }
}

describe('T025 attack: an application whose whole policy is global', () => {
  it('should tell a reader that every route is guarded, and by what', () => {
    // Given guards, an interceptor and a pipe all registered globally and nothing on any route,
    // which is the arrangement TX-GLOBALGUARD found and the family it belongs to
    const allGlobal: DiscoveryServiceLike = {
      getControllers: () => [{ metatype: OrdersController, instance: new OrdersController() }],
      getProviders: () => [
        { subtype: 'guard', instance: new ReadonlyGuard() },
        { subtype: 'interceptor', instance: new LoggingInterceptor() },
        { subtype: 'pipe', instance: new TrimPipe() },
        { subtype: 'filter', instance: new EverythingFilter() },
      ],
    };

    // When
    const result = runRuntimePass(document(), {
      collectors: [],
      discovery: allGlobal,
      reflector,
      moduleRef,
    });

    // Then the hash is over the document as served, and the pass did not fall over the three
    // families it does not read
    expect(result.document.hash).toBe(hashDocument(result.document));
    expect(result.discoveryProblems).toEqual([]);
  });
});

describe('T025 attack: source links in a repository that is not the ordinary one', () => {
  /** A repository built for one case, under the test's own temporary directory. */
  function repositoryAt(name: string): string {
    const root = join(mkdtempSync(join(tmpdir(), 'openref-t025-')), name);
    mkdirSync(root, { recursive: true });
    run(root, 'init', '-q', '.');
    run(root, 'config', 'user.email', 'nobody@example.invalid');
    run(root, 'config', 'user.name', 'nobody');

    return root;
  }

  function run(cwd: string, ...args: readonly string[]): string {
    return execFileSync('git', [...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  }

  /** The collector over one handler whose file is wherever the case put it. */
  function locatedAt(file: string): SourceCollector {
    return sourceCollector({ locate: () => ({ location: { file, line: 7 } }) });
  }

  it('should still resolve a ref with HEAD detached, which is an ordinary CI checkout', () => {
    // Given two commits and a checkout of the first, which is what every shallow CI clone of a
    // pull request produces. The attack is whether `{ref}` degrades there.
    const root = repositoryAt('detached');
    writeFileSync(join(root, 'a.ts'), 'export const one = 1;\n');
    run(root, 'add', '.');
    run(root, 'commit', '-qm', 'one');
    writeFileSync(join(root, 'a.ts'), 'export const two = 2;\n');
    run(root, 'commit', '-qam', 'two');
    run(root, 'checkout', '-q', 'HEAD~1');
    resetRepositoryCache();

    // When
    const ref = resolveGitRef(root);

    // Then a detached HEAD is still a commit, and the sha it names is the one the code came from
    expect(ref).toMatch(/^[0-9a-f]{40}$/);
  });

  it('should refuse to link a handler inside a submodule rather than link into the wrong repo', () => {
    // Given a superproject with a submodule, which is how a vendored library is checked out. Both
    // the path and the revision found there belong to the submodule, and the template the host
    // configured names the superproject's forge, so a link would resolve somewhere else entirely.
    const inner = repositoryAt('inner');
    writeFileSync(join(inner, 'lib.ts'), 'export const lib = 1;\n');
    run(inner, 'add', '.');
    run(inner, 'commit', '-qm', 'lib');

    const top = repositoryAt('top');
    writeFileSync(join(top, 'top.ts'), 'export const top = 1;\n');
    run(top, 'add', '.');
    run(top, 'commit', '-qm', 'top');
    run(top, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', inner, 'vendor');
    run(top, 'commit', '-qm', 'vendored');
    resetRepositoryCache();

    // When
    const collector = locatedAt(join(top, 'vendor', 'lib.ts'));
    const produced = collector.collect(contextFor());

    // Then no file reaches the IR, and the reason names the submodule
    expect(produced?.source).toEqual({ controller: 'OrdersController', handler: 'readOrder' });
    expect(collector.problems()[0]?.reason).toContain('submodule');
  });

  it('should link a file the repository does not track, which SPEC 6.3 records as accepted', () => {
    // Given a committed file beside an uncommitted one, which is every developer's working tree.
    // `{ref}` is the sha of HEAD, so a link to the uncommitted one lands on a 404.
    //
    // THIS CASE ASSERTS THE DEFECT RATHER THAN A FIX, AND THE REASON IS THE FIX THAT WAS TRIED.
    // Refusing the file was written first and the compatibility matrix rejected it within one run:
    // a build with no source maps has `dist/serve.js` as its source, `dist` is ignored in every
    // repository, and SPEC 6.3 states in its own paragraph that such a build must NOT degrade. The
    // two promises tangled here are different, and the refusal collapsed them: the LOCATION is
    // true, the file and the line are the code that runs, and only the LINK fails to resolve.
    // Separating them means a field on `IRSourceLocation` and a branch in `expandSourceLink`, and
    // that is a shape change rather than a check. Recorded in SPEC 6.3, not fixed here.
    const root = repositoryAt('uncommitted');
    writeFileSync(join(root, 'committed.ts'), 'export const one = 1;\n');
    run(root, 'add', '.');
    run(root, 'commit', '-qm', 'one');
    writeFileSync(join(root, 'uncommitted.ts'), 'export const two = 2;\n');
    resetRepositoryCache();

    // When
    const uncommitted = locatedAt(join(root, 'uncommitted.ts'));
    const produced = uncommitted.collect(contextFor());

    // Then the location is emitted, because it is true, and nothing yet says the link will 404
    expect(produced?.source?.file).toBe('uncommitted.ts');
    expect(produced?.source?.line).toBe(7);
  });

  it('should link a file reached through a symlinked path, rather than escaping the root', () => {
    // Given a repository reached by a symlink, which is what a pnpm workspace link and /tmp on
    // macOS both produce. `relative` is textual, so a root and a file discovered by different
    // names would compute `..` and refuse a link that ought to work.
    const root = repositoryAt('symlinked');
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'orders.ts'), 'export const one = 1;\n');
    run(root, 'add', '.');
    run(root, 'commit', '-qm', 'one');
    const link = join(dirname(root), 'linked');
    symlinkSync(root, link, 'dir');
    resetRepositoryCache();

    // When the handler is reported at the symlinked path
    const collector = locatedAt(join(link, 'src', 'orders.ts'));
    const produced = collector.collect(contextFor());

    // Then
    expect(produced?.source?.file).toBe('src/orders.ts');
  });
});
