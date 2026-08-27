function operation() {
  return {
    kind: 'operation',
    id: 'post-widgets',
    method: 'post',
    path: '/widgets',
    rawOperationId: 'postWidgets',
    summary: 'Create a widget',
    tags: [],
    deprecated: false,
    parameters: [],
    responses: [{ statusCode: '201', description: 'created', content: [] }],
    security: [],
    servers: [],
    runtime: {
      guards: [
        { name: 'AuthGuard', scope: 'route', confidence: 'declared', collector: 'guardsCollector' },
      ],
    },
  };
}

export async function createApp() {
  const document = {
    id: 'error-drift',
    kind: 'openapi',
    hash: 'h',
    info: { title: 'ErrorDrift', version: '1.0.0' },
    servers: [],
    navigation: [],
    nodes: new Map([['post-widgets', operation()]]),
    schemas: new Map(),
    security: [],
    relationships: [],
    webhooks: new Map(),
  };

  return {
    get(token) {
      if (token !== 'OPENREF_REFERENCES') return undefined;
      return { all: () => [{ pass: { document } }] };
    },
    close: () => Promise.resolve(),
  };
}
