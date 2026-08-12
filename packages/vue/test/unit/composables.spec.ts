import { ErrorCode, RunnerError, ThemeContractError } from '@openref/core';
import { createSSRApp, defineComponent, h, nextTick, ref } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { describe, expect, it } from 'vitest';
import type { ISearchPort, SearchHit } from '../../src/index';
import {
  createDocState,
  useChannel,
  useDocState,
  useDocument,
  useHealth,
  useNode,
  useOperation,
  useRunner,
  useRuntime,
  useSchemaView,
  useSearch,
  useSocket,
  useTheme,
} from '../../src/index';
import { mutuallyRecursiveDocument, runtimeDocument, simpleDocument } from '../mocks/documents';
import { withDocState } from '../mocks/render';

function fakeIndex(hits: readonly SearchHit[]): ISearchPort {
  return { search: (_query, limit) => hits.slice(0, limit ?? hits.length) };
}

describe('useDocState', () => {
  it('should refuse to run without a state provided above it', async () => {
    // Given
    const child = defineComponent({
      name: 'Orphan',
      setup() {
        useDocState();
        return () => h('div');
      },
    });

    // When
    const render = renderToString(createSSRApp(child));

    // Then
    await expect(render).rejects.toBeInstanceOf(ThemeContractError);
  });

  it('should name the missing provider in the error code', async () => {
    // Given
    const child = defineComponent({
      name: 'Orphan',
      setup() {
        useDocState();
        return () => h('div');
      },
    });

    // When
    let thrown: unknown;
    try {
      await renderToString(createSSRApp(child));
    } catch (error: unknown) {
      thrown = error;
    }

    // Then
    expect((thrown as ThemeContractError).code).toBe(ErrorCode.THEME_CONTRACT_VIOLATED);
  });
});

describe('useDocument', () => {
  it('should expose the document and its parts', async () => {
    // Given
    const state = createDocState({ document: simpleDocument() });

    // When
    const document = await withDocState(state, () => useDocument());

    // Then
    expect(document.info.value.title).toBe('Orders API');
    expect(document.kind.value).toBe('http');
    expect(document.hash.value).toBe(state.document.value.hash);
    expect(document.servers.value[0]?.url).toBe('https://api.example.com');
    expect(document.security.value[0]?.id).toBe('bearer');
    expect(document.navigation.value.map((group) => group.label)).toContain('Orders');
    expect(document.nodeIds.value).toContain('get-orders');
  });

  it('should move the selection through select', async () => {
    // Given
    const state = createDocState({ document: simpleDocument() });
    const document = await withDocState(state, () => useDocument());

    // When
    document.select('post-orders');

    // Then
    expect(state.activeNodeId.value).toBe('post-orders');
    document.select(undefined);
    expect(state.activeNodeId.value).toBeUndefined();
  });

  it('should follow a replaced document', async () => {
    // Given
    const state = createDocState({ document: simpleDocument() });
    const document = await withDocState(state, () => useDocument());

    // When
    state.setDocument(mutuallyRecursiveDocument());
    await nextTick();

    // Then
    expect(document.info.value.title).toBe('Pair');
  });
});

describe('useNode', () => {
  it('should follow the current selection when given no id', async () => {
    // Given
    const state = createDocState({ document: simpleDocument(), activeNodeId: 'get-orders' });

    // When
    const node = await withDocState(state, () => useNode());

    // Then
    expect(node.id.value).toBe('get-orders');
    expect(node.node.value?.title).toBe('List orders');
    expect(node.exists.value).toBe(true);
  });

  it('should accept a getter and re-derive when it changes', async () => {
    // Given
    const state = createDocState({ document: simpleDocument() });
    const wanted = ref('get-orders');

    // When
    const node = await withDocState(state, () => useNode(wanted));
    const first = node.node.value?.id;
    wanted.value = 'post-orders';

    // Then
    expect(first).toBe('get-orders');
    expect(node.node.value?.id).toBe('post-orders');
  });

  it('should report a node that does not exist rather than throwing', async () => {
    // Given
    const state = createDocState({ document: simpleDocument() });

    // When
    const node = await withDocState(state, () => useNode('nothing'));

    // Then
    expect(node.node.value).toBeUndefined();
    expect(node.exists.value).toBe(false);
  });

  it('should materialize nothing until the node is read', async () => {
    // Given
    const state = createDocState({ document: simpleDocument() });

    // When
    const node = await withDocState(state, () => useNode('get-orders'));
    const before = state.isMaterialized('get-orders');
    const read = node.node.value;

    // Then
    expect(before).toBe(false);
    expect(read).toBeDefined();
    expect(state.isMaterialized('get-orders')).toBe(true);
  });
});

describe('useOperation', () => {
  it('should expose the parts of an operation', async () => {
    // Given
    const state = createDocState({ document: simpleDocument() });

    // When
    const operation = await withDocState(state, () => useOperation('get-orders'));

    // Then
    expect(operation.operation.value?.title).toBe('List orders');
    expect([...operation.parameters.value.keys()]).toEqual(['query', 'header']);
    expect(operation.responses.value.map((response) => response.statusCode)).toEqual(['200']);
    expect(operation.security.value[0]?.schemeId).toBe('bearer');
    expect(operation.deprecated.value).toBe(false);
  });

  it('should expose the request body of an operation that has one', async () => {
    // Given
    const state = createDocState({ document: simpleDocument() });

    // When
    const operation = await withDocState(state, () => useOperation('post-orders'));

    // Then
    expect(operation.requestBody.value?.required).toBe(true);
    expect(operation.requestBody.value?.content[0]?.mediaType).toBe('application/json');
  });

  it('should yield nothing for a node that is not an operation', async () => {
    // Given, no channels exist until M5, so an id naming nothing stands in for the narrowing.
    const state = createDocState({ document: simpleDocument() });

    // When
    const operation = await withDocState(state, () => useOperation('not-a-node'));

    // Then
    expect(operation.operation.value).toBeUndefined();
    expect(operation.responses.value).toEqual([]);
    expect(operation.parameters.value.size).toBe(0);
  });
});

describe('useChannel', () => {
  it('should find nothing in an HTTP document, since channels arrive in M5', async () => {
    // Given
    const state = createDocState({ document: simpleDocument() });

    // When
    const channel = await withDocState(state, () => useChannel('get-orders'));

    // Then
    expect(channel.channel.value).toBeUndefined();
    expect(channel.operations.value).toEqual([]);
    expect(channel.messages.value).toEqual([]);
  });
});

describe('useSchemaView', () => {
  it('should switch the view and expand a tree one level at a time', async () => {
    // Given
    const state = createDocState({ document: simpleDocument() });
    const view = await withDocState(state, () => useSchemaView());

    // When
    view.setView('request');
    const root = view.root('Order');
    const children = view.children(root!);

    // Then
    expect(state.view.value).toBe('request');
    expect(children.map((child) => child.label)).toEqual(['note', 'total']);
  });

  it('should track which positions are open', async () => {
    // Given
    const state = createDocState({ document: simpleDocument() });
    const view = await withDocState(state, () => useSchemaView());

    // When
    view.expand('Order');
    view.toggle('Order/id');

    // Then
    expect(view.isExpanded('Order')).toBe(true);
    expect(view.isExpanded('Order/id')).toBe(true);

    view.toggle('Order/id');
    expect(view.isExpanded('Order/id')).toBe(false);

    view.collapse('Order');
    expect(view.isExpanded('Order')).toBe(false);
  });

  it('should collapse everything at once', async () => {
    // Given
    const state = createDocState({ document: simpleDocument() });
    const view = await withDocState(state, () => useSchemaView());
    view.expand('Order');
    view.expand('Order/id');

    // When
    view.collapseAll();

    // Then
    expect([...view.expandedPaths.value]).toEqual([]);
  });

  it('should build a root over whatever a use site slot holds', async () => {
    // Given
    const state = createDocState({ document: simpleDocument() });
    const view = await withDocState(state, () => useSchemaView());

    // When
    const named = view.slotRoot({ kind: 'named', schemaId: 'Order' }, 'body');
    const inline = view.slotRoot(
      {
        kind: 'inline',
        schema: { id: 'x', dialect: 'json-schema-2020-12', normalized: { type: 'string' } },
      },
      'application/json',
    );

    // Then
    expect(named?.schemaId).toBe('Order');
    expect(inline?.label).toBe('application/json');
    expect(inline?.schema.type).toBe('string');
  });

  it('should yield nothing for a slot whose schema carries no normalized body', async () => {
    // Given, a non JSON Schema dialect takes the raw path and has no tree to expand.
    const state = createDocState({ document: simpleDocument() });
    const view = await withDocState(state, () => useSchemaView());

    // When
    const root = view.slotRoot(
      { kind: 'inline', schema: { id: 'avro', dialect: 'avro', raw: {} } },
      'payload',
    );

    // Then
    expect(root).toBeUndefined();
  });

  it('should expose the document schema map', async () => {
    // Given
    const state = createDocState({ document: simpleDocument() });

    // When
    const view = await withDocState(state, () => useSchemaView());

    // Then
    expect([...view.schemas.value.keys()]).toEqual(['Order']);
  });
});

describe('useSearch', () => {
  it('should report itself unavailable when no index was supplied', async () => {
    // Given, an empty result list and a missing index look identical to a user.
    const state = createDocState({ document: simpleDocument() });

    // When
    const search = await withDocState(state, () => useSearch());
    search.search('orders');

    // Then
    expect(search.available).toBe(false);
    expect(search.hits.value).toEqual([]);
    expect(search.hasQuery.value).toBe(true);
  });

  it('should query the index it was given', async () => {
    // Given
    const hits: SearchHit[] = [
      { id: 'get-orders', kind: 'operation', title: 'List orders', score: 4 },
      { id: 'post-orders', kind: 'operation', title: 'Create an order', score: 2 },
    ];
    const state = createDocState({ document: simpleDocument(), search: fakeIndex(hits) });

    // When
    const search = await withDocState(state, () => useSearch());
    search.search('orders');

    // Then
    expect(search.available).toBe(true);
    expect(search.hits.value.map((hit) => hit.id)).toEqual(['get-orders', 'post-orders']);
  });

  it('should honour the hit limit', async () => {
    // Given
    const hits: SearchHit[] = [
      { id: 'a', kind: 'operation', title: 'a', score: 3 },
      { id: 'b', kind: 'operation', title: 'b', score: 2 },
    ];
    const state = createDocState({ document: simpleDocument(), search: fakeIndex(hits) });

    // When
    const search = await withDocState(state, () => useSearch(1));
    search.search('a');

    // Then
    expect(search.hits.value).toHaveLength(1);
  });

  it('should return nothing for a query that is only whitespace', async () => {
    // Given
    const hits: SearchHit[] = [{ id: 'a', kind: 'operation', title: 'a', score: 1 }];
    const state = createDocState({ document: simpleDocument(), search: fakeIndex(hits) });

    // When
    const search = await withDocState(state, () => useSearch());
    search.search('   ');

    // Then
    expect(search.hits.value).toEqual([]);
    expect(search.hasQuery.value).toBe(false);
  });

  it('should clear the query', async () => {
    // Given
    const state = createDocState({ document: simpleDocument() });
    const search = await withDocState(state, () => useSearch());
    search.search('orders');

    // When
    search.clear();

    // Then
    expect(state.query.value).toBe('');
  });
});

describe('useTheme', () => {
  it('should expose the default theme when none was supplied', async () => {
    // Given
    const state = createDocState({ document: simpleDocument() });

    // When
    const theme = await withDocState(state, () => useTheme());

    // Then
    expect(theme.name.value).toBe('default');
    expect(theme.tokens.value).toEqual({});
    expect(theme.overridden.value).toEqual([]);
    expect(theme.slot('StateNotice')).toBeUndefined();
  });

  it('should expose the tokens and overrides of a supplied theme', async () => {
    // Given
    const Stub = defineComponent({ name: 'Stub', setup: () => () => h('span') });
    const state = createDocState({
      document: simpleDocument(),
      theme: {
        name: 'aurora',
        tokens: { '--oref-color-fg': '#e6e6e6' },
        components: { StateNotice: Stub },
        assets: { css: ['./aurora.css'] },
      },
    });

    // When
    const theme = await withDocState(state, () => useTheme());

    // Then
    expect(theme.name.value).toBe('aurora');
    expect(theme.tokens.value['--oref-color-fg']).toBe('#e6e6e6');
    expect(theme.assets.value.css).toEqual(['./aurora.css']);
    expect(theme.slot('StateNotice')).toBe(Stub);
    expect(theme.overridden.value).toEqual(['StateNotice']);
  });
});

describe('useRuntime', () => {
  it('should report that no collector ran, rather than that the node has no guards', async () => {
    // Given, a document normalized outside any application, which is most documents.
    const state = createDocState({ document: simpleDocument() });

    // When
    const runtime = await withDocState(state, () => useRuntime('get-orders'));

    // Then
    expect(runtime.available.value).toBe(false);
    expect(runtime.runtime.value).toBeUndefined();
    expect(runtime.guards.value).toEqual([]);
    expect(runtime.drift.value).toEqual([]);
    expect(runtime.meta.value).toBeUndefined();
  });

  it('should tell a theme there is nothing to draw rather than nothing to say', async () => {
    // Given, SPEC 6.3: the block is absent and not empty, and the predicate saying so is the one
    // `@openref/core` exports, so a theme and the renderer cannot come to disagree about it.
    const state = createDocState({ document: simpleDocument() });

    // When
    const runtime = await withDocState(state, () => useRuntime('get-orders'));

    // Then
    expect(runtime.hasFacts.value).toBe(false);
  });

  it('should hand every fact over with its provenance still on it', async () => {
    // Given an application that answered, at all three levels of SPEC 6.1
    const state = createDocState({ document: runtimeDocument() });

    // When
    const runtime = await withDocState(state, () => useRuntime('get-orders'));

    // Then, wrappers rather than bare values: dropping the provenance has to be a decision
    expect(runtime.hasFacts.value).toBe(true);
    expect(runtime.scopes.value).toEqual({
      value: ['orders:read'],
      confidence: 'declared',
      collector: 'scopesCollector',
    });
    expect(runtime.rateLimit.value?.confidence).toBe('derived');
    expect(runtime.errors.value?.declared).toEqual([]);
    expect(runtime.source.value?.handler).toBe('findAll');
  });

  it('should expand the source link, or say why there is none', async () => {
    // Given a document whose host configured no template, which is the ordinary case
    const state = createDocState({ document: runtimeDocument({ sourceLink: false }) });

    // When
    const runtime = await withDocState(state, () => useRuntime('get-orders'));

    // Then, the reason and never a link with a placeholder still in it
    expect(runtime.sourceLink.value?.url).toBeUndefined();
    expect(runtime.sourceLink.value?.reason).toContain('no source link template');
  });

  it('should read the findings of one node out of the document report', async () => {
    // Given, the rules of SPEC 7.1 run once over the document, so the findings live there
    const state = createDocState({ document: runtimeDocument() });

    // When
    const runtime = await withDocState(state, () => useRuntime('get-orders'));

    // Then
    expect(runtime.drift.value.length).toBeGreaterThan(0);
    expect(runtime.drift.value.every((issue) => issue.nodeId === 'get-orders')).toBe(true);
  });
});

describe('useHealth', () => {
  it('should report that nothing measured the document rather than a score of zero', async () => {
    // Given a document no drift engine ever ran over.
    const state = createDocState({ document: simpleDocument() });

    // When
    const health = await withDocState(state, () => useHealth());

    // Then
    expect(health.available.value).toBe(false);
    expect(health.score.value).toBeUndefined();
    expect(health.checks.value).toEqual([]);
    expect(health.drift.value).toEqual([]);
    expect(health.byRule.value).toEqual([]);
  });

  it('should group the findings by rule, which is what a panel can list', async () => {
    // Given, SPEC 7.3: four hundred findings are still at most ten rules
    const state = createDocState({ document: runtimeDocument() });

    // When
    const health = await withDocState(state, () => useHealth());

    // Then
    expect(health.available.value).toBe(true);
    expect(health.byRule.value.length).toBeGreaterThan(0);
    expect(health.byRule.value.length).toBeLessThanOrEqual(10);
    const counted = [...health.counts.value.values()].reduce((sum, count) => sum + count, 0);
    expect(counted).toBe(health.drift.value.length);
  });

  it('should keep a failed collector among the checks and out of the findings', async () => {
    // Given, SPEC 7: a broken tool is a health check and never a drift row, because a drift row
    // sends a reader to edit their own code and this is not something they can fix there.
    const state = createDocState({ document: runtimeDocument({ failedCollector: true }) });

    // When
    const health = await withDocState(state, () => useHealth());

    // Then
    expect(health.checks.value.map((check) => check.id)).toContain('runtime-collectors');
    expect(health.drift.value.map((issue) => issue.rule)).not.toContain('runtime-collectors');
  });
});

describe('useRunner and useSocket', () => {
  it('should report the runner unavailable and refuse to send', async () => {
    // Given
    const state = createDocState({ document: simpleDocument() });

    // When
    const runner = await withDocState(state, () => useRunner('get-orders'));

    // Then
    expect(runner.available.value).toBe(false);
    await expect(
      runner.send({ serverUrl: 'https://api.example.com', values: {} }),
    ).rejects.toBeInstanceOf(RunnerError);
  });

  it('should carry the not available code rather than a generic failure', async () => {
    // Given
    const state = createDocState({ document: simpleDocument() });
    const runner = await withDocState(state, () => useRunner('get-orders'));

    // When
    let thrown: unknown;
    try {
      await runner.send({ serverUrl: 'https://api.example.com', values: {} });
    } catch (error: unknown) {
      thrown = error;
    }

    // Then
    expect((thrown as RunnerError).code).toBe(ErrorCode.RUN_NOT_AVAILABLE);
    expect((thrown as RunnerError).context?.nodeId).toBe('get-orders');
  });

  it('should report the socket client unavailable and refuse to connect', async () => {
    // Given
    const state = createDocState({ document: simpleDocument() });

    // When
    const socket = await withDocState(state, () => useSocket('get-orders'));

    // Then
    expect(socket.available.value).toBe(false);
    await expect(socket.connect()).rejects.toBeInstanceOf(RunnerError);
  });
});
